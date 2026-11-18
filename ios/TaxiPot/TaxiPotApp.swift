import SwiftUI
import MapKit
import GoogleMobileAds
@preconcurrency import UserMessagingPlatform
import KakaoSDKCommon
import KakaoSDKAuth
import KakaoSDKShare
import KakaoSDKTemplate
import KakaoSDKUser

private enum Region: String, CaseIterable, Identifiable {
    case metro

    var id: String { rawValue }
    var name: String { "수도권" }
    var center: CLLocationCoordinate2D { .init(latitude: 37.5663, longitude: 126.9779) }
}

private struct Member: Decodable, Identifiable {
    let id: String
    let name: String
    let university: String?
    let avatarUrl: String?
}

private struct MemberAvatar: View {
    let member: Member
    var body: some View {
        AsyncImage(url: member.avatarUrl.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String(member.name.prefix(1))).font(.caption.bold()).foregroundStyle(.orange)
                .frame(maxWidth: .infinity, maxHeight: .infinity).background(.orange.opacity(0.12))
        }
        .frame(width: 28, height: 28).clipShape(Circle())
        .accessibilityHidden(true)
    }
}

private struct Meeting: Codable {
    let lat: Double
    let lng: Double
    let note: String
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

private struct Party: Decodable, Identifiable {
    let id: String
    let region: String
    let university: String
    let title: String
    let departureAt: String
    let seats: Int
    let meeting: Meeting
    let members: [Member]
    let fare: Int?
    let shares: [Int]?
    let completedAt: String?

    var departure: Date {
        ISO8601DateFormatter.fractional.date(from: departureAt)
            ?? ISO8601DateFormatter().date(from: departureAt)
            ?? .distantPast
    }
    var isOpen: Bool { fare == nil && departure > .now && members.count < seats }
    var shareText: String {
        "대택구 | \(title)\n\(departure.koreanDate) · \(meeting.note.isEmpty ? "지도 핀에서 만나요" : meeting.note)\n\(university)까지 함께 가요!"
    }
}

private struct ChatMessage: Decodable, Identifiable {
    let id: Int
    let senderId: String
    let senderName: String
    let body: String
    let createdAt: String
}

private extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension Date {
    var koreanDate: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 (E) HH:mm"
        return formatter.string(from: self)
    }
}

private struct MessageResponse: Decodable { let error: String }
private struct MeResponse: Decodable { let user: Member? }
private struct PartiesResponse: Decodable { let parties: [Party] }
private struct PartyResponse: Decodable { let party: Party }
private struct SessionResponse: Decodable { let user: Member }
private struct UniversitiesResponse: Decodable { let universities: [String] }
private struct ChatMessagesResponse: Decodable { let messages: [ChatMessage] }
private struct ChatMessageResponse: Decodable { let message: ChatMessage }
private struct OKResponse: Decodable { let ok: Bool }
private struct SessionInput: Encodable { let name: String }
private struct LoginInput: Encodable { let loginId: String; let password: String }
private struct RegisterInput: Encodable { let loginId: String; let password: String; let name: String; let university: String }
private struct KakaoSessionInput: Encodable { let accessToken: String }
private struct FareInput: Encodable { let fare: Int }
private struct ChatInput: Encodable { let body: String }
private struct CreateInput: Encodable {
    let region: String
    let title: String
    let departureAt: String
    let seats: Int
    let meeting: Meeting
}

private enum APIError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let value): value }
    }
}

@MainActor private final class PartyStore: ObservableObject {
    private static let cloudServer = "https://taxipot.tight-field-ce73.workers.dev"
    @Published var region: Region = .metro
    @Published var user: Member?
    @Published var universities: [String] = []
    @Published var loaded = false
    @Published var parties: [Party] = []
    @Published var error: String?
    @Published var serverAddress: String = {
        let saved = UserDefaults.standard.string(forKey: "TaxiPotServer")
        if let saved, !saved.isEmpty,
           saved != "http://127.0.0.1:3000", saved != "http://192.168.45.26:3000" {
            return saved
        }
        return PartyStore.cloudServer
    }()

    var isPublicBackend: Bool {
        guard let url = URL(string: serverAddress), let host = url.host else { return false }
        return url.scheme == "https" && host != "localhost" && host != "127.0.0.1"
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> T {
        guard let base = URL(string: serverAddress),
              ["http", "https"].contains(base.scheme ?? ""),
              let url = URL(string: path, relativeTo: base)?.absoluteURL else {
            throw APIError.message("서버 주소를 확인해 주세요.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) }
        catch { throw APIError.message("서버에 연결할 수 없습니다. 서버 주소와 실행 상태를 확인해 주세요.") }
        guard let http = response as? HTTPURLResponse else { throw APIError.message("서버 응답을 확인할 수 없습니다.") }
        if !(200..<300).contains(http.statusCode) {
            throw APIError.message((try? JSONDecoder().decode(MessageResponse.self, from: data).error) ?? "요청에 실패했습니다.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func load() async {
        defer { loaded = true }
        do {
            let catalog: UniversitiesResponse = try await request("/api/universities")
            universities = catalog.universities
            let response: MeResponse = try await request("/api/me")
            user = response.user
            if user != nil { try await refresh() } else { parties = [] }
        } catch { self.error = error.localizedDescription }
    }

    func refresh() async throws {
        guard user != nil else { parties = []; return }
        let result: PartiesResponse = try await request("/api/parties")
        parties = result.parties
    }

    func updateName(_ name: String) async throws {
        let result: SessionResponse = try await request("/api/session", method: "POST", body: SessionInput(name: name))
        user = result.user
        try await refresh()
    }

    func authenticate(loginId: String, password: String, name: String?, university: String?) async throws {
        let result: SessionResponse
        if let name, let university {
            result = try await request("/api/register", method: "POST", body: RegisterInput(loginId: loginId, password: password, name: name, university: university))
        } else {
            result = try await request("/api/login", method: "POST", body: LoginInput(loginId: loginId, password: password))
        }
        user = result.user
        try await refresh()
    }

    func logout() async throws {
        let _: OKResponse = try await request("/api/logout", method: "POST")
        user = nil
        parties = []
    }

    func signInWithKakao(_ accessToken: String) async throws {
        let result: SessionResponse = try await request("/api/session/kakao", method: "POST", body: KakaoSessionInput(accessToken: accessToken))
        user = result.user
        try await refresh()
    }

    func create(title: String, departure: Date, seats: Int, meeting: Meeting) async throws -> Party {
        let formatter = ISO8601DateFormatter.fractional
        let result: PartyResponse = try await request("/api/parties", method: "POST", body: CreateInput(region: region.rawValue, title: title, departureAt: formatter.string(from: departure), seats: seats, meeting: meeting))
        try await refresh()
        return result.party
    }

    func act(_ action: String, on party: Party, fare: Int? = nil) async throws {
        let path = "/api/parties/\(party.id)/\(action)"
        if let fare {
            let _: PartyResponse = try await request(path, method: "POST", body: FareInput(fare: fare))
        } else if action == "cancel" {
            let _: OKResponse = try await request(path, method: "POST")
        } else {
            let _: PartyResponse = try await request(path, method: "POST")
        }
        try await refresh()
    }

    func chatMessages(in party: Party, after: Int?) async throws -> [ChatMessage] {
        let cursor = after.map { "?after=\($0)" } ?? ""
        let result: ChatMessagesResponse = try await request("/api/parties/\(party.id)/messages\(cursor)")
        return result.messages
    }

    func sendChatMessage(_ body: String, in party: Party) async throws -> ChatMessage {
        let result: ChatMessageResponse = try await request("/api/parties/\(party.id)/messages", method: "POST", body: ChatInput(body: body))
        return result.message
    }

    func setServer(_ value: String) async {
        serverAddress = value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        UserDefaults.standard.set(serverAddress, forKey: "TaxiPotServer")
        await load()
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

private enum KakaoShare {
    static var key: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "KakaoNativeAppKey") as? String ?? ""
        return value.hasPrefix("$(") ? "" : value
    }
    static func send(_ party: Party, text: String? = nil, onError: @escaping (String) -> Void) {
        guard ShareApi.isKakaoTalkSharingAvailable() else {
            onError("카카오톡을 설치한 뒤 다시 시도해 주세요. 일반 공유도 사용할 수 있습니다.")
            return
        }
        let template = TextTemplate(text: text ?? party.shareText, link: Link(iosExecutionParams: ["party": party.id]), buttonTitle: "파티 보기")
        ShareApi.shared.shareDefault(templatable: template) { result, error in
            Task { @MainActor in
                if let error { onError(error.localizedDescription); return }
                guard let result else { onError("카카오톡 공유를 시작하지 못했습니다."); return }
                UIApplication.shared.open(result.url)
            }
        }
    }
}

@MainActor private final class MonetizationStore: NSObject, ObservableObject, FullScreenContentDelegate {
    private var interstitial: InterstitialAd?
    private var interstitialLoadedAt: Date?
    private var consentStarted = false
    @Published var adsReady = false
    @Published var privacyOptionsRequired = false

    var showsAd: Bool { adsReady }

    override init() {
        super.init()
        requestAds()
    }

    private func requestAds() {
        if consentStarted { return }
        consentStarted = true
        ConsentInformation.shared.requestConsentInfoUpdate(with: RequestParameters()) { [weak self] _ in
            Task { @MainActor in
                try? await ConsentForm.loadAndPresentIfRequired(from: nil)
                guard let self else { return }
                self.privacyOptionsRequired = ConsentInformation.shared.privacyOptionsRequirementStatus == .required
                if ConsentInformation.shared.canRequestAds {
                    #if !DEBUG
                    guard let unit = Bundle.main.object(forInfoDictionaryKey: "AdMobBannerID") as? String, !unit.isEmpty else { return }
                    #endif
                    await MobileAds.shared.start()
                    self.adsReady = true
                    await self.loadInterstitial()
                }
            }
        }
    }

    private func loadInterstitial() async {
        guard adsReady, ConsentInformation.shared.canRequestAds else { return }
        #if DEBUG
        let unit = "ca-app-pub-3940256099942544/4411468910"
        #else
        let unit = Bundle.main.object(forInfoDictionaryKey: "AdMobInterstitialID") as? String ?? ""
        #endif
        guard !unit.isEmpty else { return }
        interstitial = try? await InterstitialAd.load(with: unit, request: Request())
        interstitial?.fullScreenContentDelegate = self
        interstitialLoadedAt = interstitial == nil ? nil : .now
    }

    func showCompletionAd(for partyId: String) {
        if let loadedAt = interstitialLoadedAt, Date().timeIntervalSince(loadedAt) >= 3600 {
            interstitial = nil
            Task { await loadInterstitial() }
            return
        }
        if interstitial == nil {
            Task { await loadInterstitial() }
            return
        }
        let defaults = UserDefaults.standard
        guard adsReady, ConsentInformation.shared.canRequestAds,
              let ad = interstitial, let loadedAt = interstitialLoadedAt,
              Date().timeIntervalSince(loadedAt) < 3600,
              defaults.string(forKey: "LastInterstitialParty") != partyId,
              Date().timeIntervalSince1970 - defaults.double(forKey: "LastInterstitialAt") >= 86_400 else { return }
        defaults.set(partyId, forKey: "LastInterstitialParty")
        defaults.set(Date().timeIntervalSince1970, forKey: "LastInterstitialAt")
        ad.present(from: nil)
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        interstitial = nil
        Task { await loadInterstitial() }
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        interstitial = nil
        Task { await loadInterstitial() }
    }

    func showPrivacyOptions() async throws {
        try await ConsentForm.presentPrivacyOptionsForm(from: nil)
    }
}

private struct AdBanner: UIViewRepresentable {
    let width: CGFloat
    func makeUIView(context: Context) -> BannerView {
        let banner = BannerView(adSize: largeAnchoredAdaptiveBanner(width: width))
        #if DEBUG
        banner.adUnitID = "ca-app-pub-3940256099942544/2435281174"
        #else
        banner.adUnitID = Bundle.main.object(forInfoDictionaryKey: "AdMobBannerID") as? String ?? ""
        #endif
        banner.rootViewController = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
        banner.load(Request())
        return banner
    }
    func updateUIView(_ view: BannerView, context: Context) {}
}

@main struct TaxiPotApp: App {
    init() {
        if !KakaoShare.key.isEmpty { KakaoSDK.initSDK(appKey: KakaoShare.key) }
    }
    var body: some Scene { WindowGroup { ContentView() } }
}

private struct ContentView: View {
    @StateObject private var store = PartyStore()
    @StateObject private var monetization = MonetizationStore()
    @State private var camera: MapCameraPosition = .region(.init(center: Region.metro.center, latitudinalMeters: 2400, longitudinalMeters: 2400))
    @State private var selectedParty: Party?
    @State private var showingCreate = false
    @State private var showingProfile = false
    @State private var showingSettings = false

    var body: some View {
        Group {
            if !store.loaded { ProgressView("대택구를 불러오는 중…") }
            else if store.user == nil { AuthView(store: store) }
            else { mainContent }
        }
        .task { if !store.loaded { await store.load() } }
    }

    private var mainContent: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("같은 방향이라면, 함께 가요").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                        Text("대택구").font(.system(size: 38, weight: .bold, design: .rounded))
                        Text("\(store.user?.university ?? "우리 대학") 친구들과\n같이 타고, 택시비는 가볍게 나눠요.").foregroundStyle(.secondary)
                    }
                    Map(position: $camera) {
                        ForEach(store.parties) { party in
                            Annotation(party.title, coordinate: party.meeting.coordinate) {
                                Button { selectedParty = party } label: { Image(systemName: "car.fill").font(.title3).foregroundStyle(.orange).padding(10).background(.white, in: Circle()).shadow(radius: 3) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                    .frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 20))
                    HStack {
                        Text("\(store.user?.university ?? "우리 대학") 파티").font(.title2.bold())
                        Spacer()
                        Text("\(store.parties.filter(\.isOpen).count)개 모집 중").font(.subheadline).foregroundStyle(.secondary)
                    }
                    if store.parties.isEmpty {
                        ContentUnavailableView("아직 파티가 없어요", systemImage: "car.side", description: Text("첫 파티를 만들어 보세요."))
                    } else {
                        ForEach(store.parties) { party in
                            Button { selectedParty = party } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text(party.completedAt != nil ? "이용 완료" : party.fare != nil ? "정산 중" : party.isOpen ? "모집 중" : "모집 마감")
                                            .font(.caption.bold())
                                            .foregroundStyle(party.isOpen ? .orange : .secondary)
                                            .padding(.horizontal, 10).padding(.vertical, 5)
                                            .background(party.isOpen ? Color.orange.opacity(0.12) : Color(.tertiarySystemFill), in: Capsule())
                                        Spacer()
                                        Text(party.departure.koreanDate).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text(party.title).font(.headline).foregroundStyle(.primary)
                                    Text("📍 \(party.meeting.note.isEmpty ? "지도에서 집결지 확인" : party.meeting.note)").font(.subheadline).foregroundStyle(.secondary)
                                    HStack {
                                        Label("\(party.members.count) / \(party.seats)명", systemImage: "person.2.fill")
                                            .font(.caption.weight(.semibold)).foregroundStyle(.primary)
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading).padding(18)
                                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                            }.buttonStyle(.plain)
                        }
                    }
                }.padding(20)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(store.user?.name ?? "프로필", systemImage: "person.crop.circle") { showingProfile = true }.tint(.primary) }
                ToolbarItem(placement: .topBarTrailing) { Button("서버", systemImage: "gearshape") { showingSettings = true }.tint(.primary) }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    if monetization.showsAd {
                        let width = min(UIScreen.main.bounds.width, 400)
                        AdBanner(width: width)
                            .frame(width: width, height: largeAnchoredAdaptiveBanner(width: width).size.height)
                    }
                    Button { showingCreate = true } label: {
                        Label("새 파티 만들기", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .primaryAction()
                    .padding(.horizontal, 20)
                }
                .padding(.vertical, 10)
                .background(.regularMaterial)
            }
            .sheet(item: $selectedParty) { PartyDetailView(store: store, monetization: monetization, original: $0) }
            .sheet(isPresented: $showingCreate) { CreatePartyView(store: store) }
            .sheet(isPresented: $showingProfile) { ProfileView(store: store, monetization: monetization) }
            .sheet(isPresented: $showingSettings) { SettingsView(store: store) }
            .partyErrorAlert(store)
            .onOpenURL { url in
                if AuthApi.isKakaoTalkLoginUrl(url) { _ = AuthController.handleOpenUrl(url: url); return }
                guard url.host == "kakaolink", let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                      let partyID = parts.queryItems?.first(where: { $0.name == "party" })?.value else { return }
                Task { try? await store.refresh(); selectedParty = store.parties.first(where: { $0.id == partyID }) }
            }
            .refreshable { try? await store.refresh() }
        }
    }
}

private struct AuthView: View {
    @ObservedObject var store: PartyStore
    @State private var register = false
    @State private var loginId = ""
    @State private var password = ""
    @State private var name = ""
    @State private var university = ""
    @State private var busy = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "car.side.fill")
                        .font(.system(size: 32)).foregroundStyle(.orange)
                        .frame(width: 66, height: 66).background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 20))
                    Text("대택구").font(.system(size: 42, weight: .bold, design: .rounded))
                    Text("같은 대학 친구들과 택시를 함께 타요.\n시작하려면 로그인해 주세요.").foregroundStyle(.secondary)
                    Picker("계정", selection: $register) {
                        Text("로그인").tag(false)
                        Text("회원가입").tag(true)
                    }.pickerStyle(.segmented).padding(.top, 16)
                    VStack(alignment: .leading, spacing: 14) {
                        TextField("아이디 (영문·숫자·밑줄 4~24자)", text: $loginId)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .textContentType(.username)
                        SecureField("비밀번호 (8자 이상)", text: $password)
                            .textContentType(register ? .newPassword : .password)
                        if register {
                            TextField("파티원에게 보일 닉네임", text: $name)
                                .textInputAutocapitalization(.never)
                            Picker("재학 중인 대학", selection: $university) {
                                Text("대학을 선택해 주세요").tag("")
                                ForEach(store.universities, id: \.self) { Text($0).tag($0) }
                            }
                            Text("선택한 대학의 파티만 이용할 수 있습니다. 가입 후 대학은 변경할 수 없습니다.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .textFieldStyle(.roundedBorder)
                    Button {
                        busy = true
                        Task {
                            do {
                                try await store.authenticate(loginId: loginId, password: password,
                                                             name: register ? name : nil, university: register ? university : nil)
                                password = ""
                            } catch { store.error = error.localizedDescription }
                            busy = false
                        }
                    } label: {
                        Text(busy ? "처리 중…" : register ? "회원가입하고 시작하기" : "로그인")
                            .frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .primaryAction()
                    .disabled(busy || loginId.count < 4 || password.count < 8 || (register && (name.count < 2 || !store.universities.contains(university))))
                    Text("현재 대학은 본인이 선택합니다. 재학 여부 확인은 준비 중입니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: 460, alignment: .leading).padding(24)
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("서버", systemImage: "gearshape") { showingSettings = true } } }
            .sheet(isPresented: $showingSettings) { SettingsView(store: store) }
            .partyErrorAlert(store)
        }
    }
}

private struct ProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PartyStore
    @ObservedObject var monetization: MonetizationStore
    @State private var name = ""
    @State private var signingIn = false
    var body: some View {
        NavigationStack {
            Form {
                Section("내 대학") {
                    Text(store.user?.university ?? "")
                    Text("가입 후 대학은 변경할 수 없습니다. 현재 재학 여부 확인은 제공하지 않습니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("카카오 프로필") {
                    if let user = store.user {
                        HStack(spacing: 10) { MemberAvatar(member: user); Text(user.name) }
                    }
                    Button {
                        signingIn = true
                        let completion: (OAuthToken?, Error?) -> Void = { token, error in
                            Task { @MainActor in
                                if let error { signingIn = false; store.error = error.localizedDescription; return }
                                guard let token else { signingIn = false; store.error = "카카오 로그인을 완료하지 못했습니다."; return }
                                finishKakaoLogin(token)
                            }
                        }
                        if UserApi.isKakaoTalkLoginAvailable() {
                            UserApi.shared.loginWithKakaoTalk(completion: completion)
                        } else {
                            UserApi.shared.loginWithKakaoAccount(completion: completion)
                        }
                    } label: { Label("카카오톡 프로필 연결", systemImage: "person.crop.circle.badge.checkmark") }
                    .disabled(signingIn || KakaoShare.key.isEmpty)
                    Text("연결하면 카카오 닉네임과 사진이 공개 파티 화면에 표시됩니다. 사진 동의가 없으면 이름만 표시됩니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("닉네임") {
                TextField("닉네임 (2~12자)", text: $name).textInputAutocapitalization(.never)
                Text("닉네임으로 전환하면 파티에 표시된 카카오 프로필 사진이 제거됩니다.").font(.footnote).foregroundStyle(.secondary)
                }
                if monetization.privacyOptionsRequired {
                    Section("광고") {
                        Button("광고 개인정보 선택") {
                            Task { do { try await monetization.showPrivacyOptions() } catch { store.error = error.localizedDescription } }
                        }
                    }
                }
                Section { Button("로그아웃", role: .destructive) {
                    Task { do { try await store.logout(); dismiss() } catch { store.error = error.localizedDescription } }
                } }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { do { try await store.updateName(name); dismiss() } catch { store.error = error.localizedDescription } }
                } label: {
                    Label("닉네임 저장", systemImage: "checkmark").frame(maxWidth: .infinity, minHeight: 54)
                }
                .primaryAction()
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(.regularMaterial)
            }
            .navigationTitle("프로필").toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .onAppear { name = store.user?.name ?? "" }
            .partyErrorAlert(store)
        }
    }

    private func finishKakaoLogin(_ token: OAuthToken) {
        UserApi.shared.me { account, _ in
            var scopes: [String] = []
            if account?.kakaoAccount?.profileNicknameNeedsAgreement == true { scopes.append("profile_nickname") }
            if account?.kakaoAccount?.profileImageNeedsAgreement == true { scopes.append("profile_image") }
            if scopes.isEmpty { saveKakaoProfile(token); return }
            UserApi.shared.loginWithKakaoAccount(scopes: scopes) { updated, _ in
                saveKakaoProfile(updated ?? token)
            }
        }
    }

    private func saveKakaoProfile(_ token: OAuthToken) {
        Task { @MainActor in
            defer { signingIn = false }
            do { try await store.signInWithKakao(token.accessToken); dismiss() }
            catch { store.error = error.localizedDescription }
        }
    }
}

private struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PartyStore
    @State private var address = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("파티 서버") {
                    TextField("https://example.com", text: $address).textInputAutocapitalization(.never).keyboardType(.URL)
                }
                Text("기본 서버는 Cloudflare의 공개 HTTPS 주소입니다. 개발 중 로컬 서버를 쓰려면 Mac과 같은 Wi-Fi에서 http://IP:3000을 입력하세요.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .safeAreaInset(edge: .bottom) {
                Button { Task { await store.setServer(address); dismiss() } } label: {
                    Label("서버 주소 저장", systemImage: "checkmark").frame(maxWidth: .infinity, minHeight: 54)
                }
                .primaryAction()
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(.regularMaterial)
            }
            .navigationTitle("설정").toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .onAppear { address = store.serverAddress }
            .partyErrorAlert(store)
        }
    }
}

private struct CreatePartyView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PartyStore
    @State private var title = ""
    @State private var departure = Date.now.addingTimeInterval(1800)
    @State private var seats = 4
    @State private var note = ""
    @State private var point: CLLocationCoordinate2D
    @State private var camera: MapCameraPosition
    @State private var saving = false

    init(store: PartyStore) {
        self.store = store
        _point = State(initialValue: store.region.center)
        _camera = State(initialValue: .region(.init(center: store.region.center, latitudinalMeters: 900, longitudinalMeters: 900)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("파티 정보").font(.title3.bold())

                    VStack(alignment: .leading, spacing: 10) {
                        Label("파티 제목", systemImage: "text.alignleft")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        TextField("예: 8시 30분 같이 가요", text: $title)
                            .font(.body.weight(.medium)).submitLabel(.done)
                            .accessibilityLabel("파티 제목")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))

                    VStack(alignment: .leading, spacing: 10) {
                        Label("출발 시간", systemImage: "clock")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        DatePicker("출발 시간", selection: $departure,
                                   in: Date.now.addingTimeInterval(900)...Date.now.addingTimeInterval(14 * 86_400),
                                   displayedComponents: [.date, .hourAndMinute])
                            .labelsHidden().datePickerStyle(.compact).tint(.orange)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))

                    VStack(alignment: .leading, spacing: 12) {
                        Label("정원", systemImage: "person.2")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        HStack(spacing: 8) {
                            ForEach(2...4, id: \.self) { count in
                                Button("\(count)명") { seats = count }
                                    .font(.headline)
                                    .frame(maxWidth: .infinity, minHeight: 48)
                                    .foregroundStyle(seats == count ? .white : .primary)
                                    .background(seats == count ? Color.orange : Color(.tertiarySystemFill),
                                                in: RoundedRectangle(cornerRadius: 14))
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("정원 \(count)명")
                                    .accessibilityAddTraits(seats == count ? .isSelected : [])
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))

                    Text("만날 위치").font(.title3.bold()).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 12) {
                        MapReader { proxy in
                            Map(position: $camera) { Annotation("집결지", coordinate: point) { Image(systemName: "mappin.circle.fill").font(.largeTitle).foregroundStyle(.orange) } }
                                .simultaneousGesture(SpatialTapGesture().onEnded { tap in
                                    if let coordinate = proxy.convert(tap.location, from: .local) { point = coordinate }
                                })
                        }
                        .frame(height: 230).clipShape(RoundedRectangle(cornerRadius: 14))
                        Text("지도를 눌러 집결지를 골라 주세요.").font(.footnote).foregroundStyle(.secondary)
                        TextField("집결지 설명 (예: 3번 출구 앞)", text: $note)
                            .padding(12).background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("집결지 설명")
                    }
                    .padding(12).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                Button {
                    saving = true
                    Task {
                        do {
                            _ = try await store.create(title: title, departure: departure, seats: seats, meeting: Meeting(lat: point.latitude, lng: point.longitude, note: note))
                            dismiss()
                        } catch { store.error = error.localizedDescription }
                        saving = false
                    }
                } label: {
                    Label(saving ? "만드는 중…" : "파티 만들기", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 54)
                }
                .primaryAction()
                .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(.regularMaterial)
            }
            .navigationTitle("새 파티").toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .partyErrorAlert(store)
        }
    }
}

private struct PartyDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @ObservedObject var store: PartyStore
    @ObservedObject var monetization: MonetizationStore
    let original: Party
    @State private var fare = ""
    @State private var busy = false
    @State private var confirmCancel = false
    @State private var confirmComplete = false
    @State private var showingChat = false

    private var party: Party { store.parties.first(where: { $0.id == original.id }) ?? original }
    private var isHost: Bool { store.user?.id == party.members.first?.id }
    private var isMember: Bool { party.members.contains(where: { $0.id == store.user?.id }) }
    private let taxiAppURL = URL(string: "kakaot://launch")!
    private let taxiURL = URL(string: "https://service.kakaomobility.com/launch/kakaot/")!
    private let splitURL = URL(string: "https://link.kakaopay.com/t/money/please?chan=payhome_more&capg=service")!
    private var shareText: String {
        guard store.isPublicBackend, var link = URLComponents(string: store.serverAddress) else { return party.shareText }
        link.path = "/"
        link.queryItems = [URLQueryItem(name: "party", value: party.id)]
        link.fragment = "find-party"
        return party.shareText + (link.url.map { "\n\($0.absoluteString)" } ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(party.title).font(.title.bold())
                    Label(party.departure.koreanDate, systemImage: "clock")
                    Label("\(party.members.count) / \(party.seats)명 · \(party.university)", systemImage: "person.2")
                    Map(initialPosition: .region(.init(center: party.meeting.coordinate, latitudinalMeters: 550, longitudinalMeters: 550))) {
                        Marker(party.meeting.note.isEmpty ? "집결지" : party.meeting.note, coordinate: party.meeting.coordinate).tint(.orange)
                    }.frame(height: 210).clipShape(RoundedRectangle(cornerRadius: 18))
                    Text("📍 \(party.meeting.note.isEmpty ? "지도 핀에서 만나요" : party.meeting.note)").font(.headline)
                    Text("함께 타는 사람").font(.headline)
                    ForEach(party.members) { member in
                        HStack(spacing: 10) { MemberAvatar(member: member); Text(member.name) }
                    }
                    if isMember {
                        Button { showingChat = true } label: {
                            Label("파티 채팅", systemImage: "bubble.left.and.bubble.right.fill")
                                .frame(maxWidth: .infinity, minHeight: 52)
                        }.secondaryAction()
                    }
                    if let total = party.fare, let shares = party.shares {
                        Divider()
                        Text("총 택시비 \(total.formatted())원").font(.title3.bold())
                        ForEach(party.members.indices, id: \.self) { index in
                            HStack(spacing: 10) { MemberAvatar(member: party.members[index]); Text(party.members[index].name); Spacer(); Text("\(shares[index].formatted())원").bold() }
                        }
                        if isHost {
                            VStack(spacing: 10) {
                                Button { openURL(splitURL) } label: {
                                    Label("카카오페이 1/N 요청 열기", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity, minHeight: 52)
                                }.primaryAction()
                                if !KakaoShare.key.isEmpty {
                                    Button {
                                        let lines = party.members.enumerated().map { "\($0.element.name) \(shares[$0.offset].formatted())원" }.joined(separator: "\n")
                                        KakaoShare.send(party, text: "대택구 | \(party.title) 정산\n총 \(total.formatted())원\n\(lines)\n카카오페이에서 금액을 확인해 주세요.") { store.error = $0 }
                                    } label: {
                                        Label("정산 내역 카카오톡 공유", systemImage: "bubble.left.and.bubble.right").frame(maxWidth: .infinity, minHeight: 52)
                                    }.secondaryAction()
                                }
                                Button { UIPasteboard.general.string = party.members.enumerated().map { "\($0.element.name): \(shares[$0.offset].formatted())원" }.joined(separator: "\n") } label: {
                                    Label("정산 금액 복사", systemImage: "doc.on.doc").frame(maxWidth: .infinity, minHeight: 52)
                                }.secondaryAction()
                            }
                            if party.completedAt == nil {
                                fareField
                                Button { confirmComplete = true } label: {
                                    Label("탑승·정산 마치기", systemImage: "checkmark.circle.fill").frame(maxWidth: .infinity, minHeight: 52)
                                }.primaryAction()
                                Text("실제 탑승과 정산 요청을 마친 뒤 눌러 주세요. 송금 완료 여부는 자동 확인되지 않습니다.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        } else {
                            Text("카카오페이에서 파티장의 정산 요청을 확인해 주세요.").font(.footnote).foregroundStyle(.secondary)
                        }
                        Text("카카오페이에서 참여자와 금액을 직접 확인해야 합니다. 송금 완료는 자동 반영되지 않습니다.").font(.footnote).foregroundStyle(.secondary)
                        if party.completedAt != nil {
                            Text("파티장이 탑승과 정산을 마쳤다고 표시했습니다. 실제 송금 완료 여부는 확인되지 않았습니다.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if isHost { Text("카카오톡 공유 화면에서 대화 상대나 채팅방을 직접 선택해 주세요. 앱이 채팅방을 만들거나 파티원을 자동 선택하지는 않습니다.").font(.footnote).foregroundStyle(.secondary) }
                    } else {
                        Divider()
                        if isHost {
                            if party.members.count >= 2 { fareField }
                            VStack(spacing: 10) {
                                Button {
                                    openURL(taxiAppURL) { opened in
                                        if !opened { openURL(taxiURL) }
                                    }
                                } label: {
                                    Label("카카오 T 앱 열기", systemImage: "car.fill").frame(maxWidth: .infinity, minHeight: 52)
                                }.primaryAction()
                                Button { UIPasteboard.general.string = party.shareText + "\n집결지: \(party.meeting.lat), \(party.meeting.lng)\n목적지: \(party.university)" } label: {
                                    Label("승차 정보 복사", systemImage: "doc.on.doc").frame(maxWidth: .infinity, minHeight: 52)
                                }.secondaryAction()
                            }
                            Button("파티 취소", role: .destructive) { confirmCancel = true }
                                .font(.subheadline.weight(.medium)).foregroundStyle(.red)
                                .frame(maxWidth: .infinity).padding(.top, 6)
                        } else if isMember {
                            Button("파티 나가기", role: .destructive) { Task { await act("leave") } }
                                .font(.subheadline.weight(.medium)).foregroundStyle(.red)
                                .frame(maxWidth: .infinity).padding(.top, 6)
                        } else if party.isOpen {
                            Button { Task { await act("join") } } label: {
                                Label("이 파티 참여하기", systemImage: "person.badge.plus").frame(maxWidth: .infinity, minHeight: 52)
                            }
                            .primaryAction()
                            .disabled(store.user == nil || busy)
                            if store.user == nil { Text("먼저 닉네임을 설정해 주세요.").font(.footnote).foregroundStyle(.secondary) }
                        }
                        if store.isPublicBackend && !KakaoShare.key.isEmpty {
                            Button { KakaoShare.send(party) { store.error = $0 } } label: {
                                Label("카카오톡으로 파티 공유", systemImage: "bubble.left.and.bubble.right").frame(maxWidth: .infinity, minHeight: 52)
                            }.secondaryAction()
                        }
                        ShareLink(item: shareText) {
                            Label("파티 정보 공유", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 52)
                        }.secondaryAction()
                        Text("카카오 T 앱에서 출발지·목적지·시간을 직접 입력하고 예약을 완료해야 합니다.").font(.footnote).foregroundStyle(.secondary)
                    }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("파티 상세").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .confirmationDialog("파티를 취소할까요?", isPresented: $confirmCancel) { Button("파티 취소", role: .destructive) { Task { await act("cancel") } } }
            .confirmationDialog("탑승과 정산 요청을 마쳤나요?", isPresented: $confirmComplete) {
                Button("파티 이용 마치기") { Task { await act("complete") } }
            } message: {
                Text("송금 완료 여부는 앱에서 확인하지 않습니다. 파티를 마치면 금액을 수정할 수 없습니다.")
            }
            .sheet(isPresented: $showingChat) { PartyChatView(store: store, original: party) }
            .partyErrorAlert(store)
        }
    }

    private var fareField: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(party.fare == nil ? "실제 택시비 입력" : "택시비 수정").font(.subheadline.weight(.semibold))
            TextField("총 택시비 (원)", text: $fare)
                .keyboardType(.numberPad).textFieldStyle(.roundedBorder)
            Button {
                guard let amount = Int(fare) else { return }
                Task { await act("fare", fare: amount) }
            } label: {
                Label(party.fare == nil ? "1/N 계산하기" : "금액 수정", systemImage: "divide").frame(maxWidth: .infinity, minHeight: 52)
            }
            .secondaryAction()
            .disabled(Int(fare) == nil || busy)
        }
    }

    private func act(_ action: String, fare: Int? = nil) async {
        busy = true
        do {
            let partyId = party.id
            try await store.act(action, on: party, fare: fare)
            if action == "cancel" { dismiss() }
            if action == "complete" { monetization.showCompletionAd(for: partyId) }
        }
        catch { store.error = error.localizedDescription }
        busy = false
    }
}

private struct PartyChatView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PartyStore
    let original: Party
    @State private var messages: [ChatMessage] = []
    @State private var lastFetchedID = 0
    @State private var loaded = false
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?

    private var party: Party { store.parties.first(where: { $0.id == original.id }) ?? original }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            if loaded && messages.isEmpty {
                                ContentUnavailableView("아직 메시지가 없어요", systemImage: "bubble.left.and.bubble.right", description: Text("파티원에게 집결지나 도착 시간을 알려보세요."))
                            }
                            ForEach(messages) { message in
                                let mine = message.senderId == store.user?.id
                                HStack(alignment: .bottom, spacing: 8) {
                                    if mine { Spacer(minLength: 44) }
                                    else {
                                        MemberAvatar(member: party.members.first(where: { $0.id == message.senderId })
                                            ?? Member(id: message.senderId, name: message.senderName, university: nil, avatarUrl: nil))
                                    }
                                    VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                                        if !mine { Text(party.members.first(where: { $0.id == message.senderId })?.name ?? message.senderName).font(.caption.weight(.semibold)) }
                                        Text(message.body)
                                            .padding(.horizontal, 13).padding(.vertical, 10)
                                            .background(mine ? Color.orange.opacity(0.2) : Color(uiColor: .secondarySystemBackground))
                                            .clipShape(RoundedRectangle(cornerRadius: 16))
                                        if let date = ISO8601DateFormatter.fractional.date(from: message.createdAt) ?? ISO8601DateFormatter().date(from: message.createdAt) {
                                            Text(date, style: .time).font(.caption2).foregroundStyle(.secondary)
                                        }
                                    }
                                    if !mine { Spacer(minLength: 44) }
                                }.id(message.id)
                            }
                        }.padding(16)
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let id = messages.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16) }
                Divider()
                HStack(alignment: .bottom, spacing: 10) {
                    TextField("파티원에게 메시지 보내기", text: $draft, axis: .vertical)
                        .lineLimit(1...3).textFieldStyle(.roundedBorder)
                        .accessibilityLabel("채팅 메시지")
                    Button { Task { await send() } } label: { Image(systemName: "arrow.up").font(.headline).frame(width: 38, height: 38) }
                        .primaryAction().disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.utf16.count > 500)
                        .accessibilityLabel("메시지 전송")
                }.padding(12).background(.regularMaterial)
            }
            .navigationTitle(party.title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .task { await poll() }
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            do {
                let fresh = try await store.chatMessages(in: party, after: loaded ? lastFetchedID : nil)
                loaded = true
                if let id = fresh.last?.id { lastFetchedID = id }
                merge(fresh)
                error = nil
            } catch { self.error = error.localizedDescription }
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
        }
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body.utf16.count <= 500 else { return }
        sending = true
        do {
            let message = try await store.sendChatMessage(body, in: party)
            draft = ""
            merge([message])
            error = nil
        } catch { self.error = error.localizedDescription }
        sending = false
    }

    private func merge(_ fresh: [ChatMessage]) {
        let existing = Set(messages.map(\.id))
        messages.append(contentsOf: fresh.filter { !existing.contains($0.id) })
        messages.sort { $0.id < $1.id }
    }
}

private extension View {
    func primaryAction() -> some View {
        font(.headline).controlSize(.large).buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 16)).tint(.orange)
    }

    func secondaryAction() -> some View {
        font(.subheadline.weight(.semibold)).controlSize(.large).buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 16)).tint(.orange)
    }

    func partyErrorAlert(_ store: PartyStore) -> some View {
        alert("확인해 주세요", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("확인", role: .cancel) { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
}
