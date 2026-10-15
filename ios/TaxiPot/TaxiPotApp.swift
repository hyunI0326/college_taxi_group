import SwiftUI
import MapKit
import KakaoSDKCommon
import KakaoSDKShare
import KakaoSDKTemplate

private enum Region: String, CaseIterable, Identifiable {
    case cityhall, gwanghwamun, seoulstation

    var id: String { rawValue }
    var name: String {
        switch self {
        case .cityhall: "시청"
        case .gwanghwamun: "광화문"
        case .seoulstation: "서울역"
        }
    }
    var center: CLLocationCoordinate2D {
        switch self {
        case .cityhall: .init(latitude: 37.5663, longitude: 126.9779)
        case .gwanghwamun: .init(latitude: 37.5716, longitude: 126.9769)
        case .seoulstation: .init(latitude: 37.5547, longitude: 126.9707)
        }
    }
}

private struct Member: Decodable, Identifiable {
    let id: String
    let name: String
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
    let title: String
    let departureAt: String
    let seats: Int
    let meeting: Meeting
    let members: [Member]
    let fare: Int?
    let shares: [Int]?

    var departure: Date {
        ISO8601DateFormatter.fractional.date(from: departureAt)
            ?? ISO8601DateFormatter().date(from: departureAt)
            ?? .distantPast
    }
    var isOpen: Bool { fare == nil && departure > .now && members.count < seats }
    var shareText: String {
        "택시팟 | \(title)\n\(departure.koreanDate) · \(meeting.note.isEmpty ? "지도 핀에서 만나요" : meeting.note)\n상명대학교까지 함께 가요!"
    }
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
private struct OKResponse: Decodable { let ok: Bool }
private struct SessionInput: Encodable { let name: String }
private struct FareInput: Encodable { let fare: Int }
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
    @Published var region: Region = .cityhall
    @Published var user: Member?
    @Published var parties: [Party] = []
    @Published var error: String?
    @Published var serverAddress = UserDefaults.standard.string(forKey: "TaxiPotServer") ?? "http://127.0.0.1:3000"

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
        do {
            let response: MeResponse = try await request("/api/me")
            user = response.user
            try await refresh()
        } catch { self.error = error.localizedDescription }
    }

    func refresh() async throws {
        let result: PartiesResponse = try await request("/api/parties?region=\(region.rawValue)")
        parties = result.parties
    }

    func changeRegion(_ value: Region) async {
        region = value
        do { try await refresh() } catch { self.error = error.localizedDescription }
    }

    func signIn(_ name: String) async throws {
        let result: SessionResponse = try await request("/api/session", method: "POST", body: SessionInput(name: name))
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
    static func send(_ party: Party, onError: @escaping (String) -> Void) {
        guard ShareApi.isKakaoTalkSharingAvailable() else {
            onError("카카오톡을 설치한 뒤 다시 시도해 주세요. 일반 공유도 사용할 수 있습니다.")
            return
        }
        let template = TextTemplate(text: party.shareText, link: Link(iosExecutionParams: ["region": party.region, "party": party.id]), buttonTitle: "파티 보기")
        ShareApi.shared.shareDefault(templatable: template) { result, error in
            Task { @MainActor in
                if let error { onError(error.localizedDescription); return }
                guard let result else { onError("카카오톡 공유를 시작하지 못했습니다."); return }
                UIApplication.shared.open(result.url)
            }
        }
    }
}

@main struct TaxiPotApp: App {
    init() {
        if !KakaoShare.key.isEmpty { KakaoSDK.initSDK(appKey: KakaoShare.key) }
    }
    var body: some Scene { WindowGroup { ContentView() } }
}

private struct ContentView: View {
    @StateObject private var store = PartyStore()
    @State private var camera: MapCameraPosition = .region(.init(center: Region.cityhall.center, latitudinalMeters: 2400, longitudinalMeters: 2400))
    @State private var selectedParty: Party?
    @State private var showingCreate = false
    @State private var showingProfile = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("같은 방향이라면, 함께 가요").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                        Text("택시팟").font(.system(size: 38, weight: .bold, design: .rounded))
                        Text("시청 · 광화문 · 서울역에서 상명대까지\n같이 타고, 택시비는 가볍게 나눠요.").foregroundStyle(.secondary)
                    }
                    HStack(spacing: 8) {
                        ForEach(Region.allCases) { region in
                            Button(region.name) { Task { await store.changeRegion(region) } }
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .background(store.region == region ? Color.orange : Color(.secondarySystemBackground), in: Capsule())
                                .foregroundStyle(store.region == region ? Color.white : Color.primary)
                        }
                    }
                    Map(position: $camera) {
                        Annotation(store.region.name, coordinate: store.region.center) { Image(systemName: "mappin.circle.fill").font(.title).foregroundStyle(.orange) }
                        ForEach(store.parties) { party in
                            Annotation(party.title, coordinate: party.meeting.coordinate) {
                                Button { selectedParty = party } label: { Image(systemName: "car.fill").font(.title3).padding(10).background(.white, in: Circle()).shadow(radius: 3) }
                            }
                        }
                    }
                    .frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 20))
                    HStack {
                        Text("\(store.region.name) 파티").font(.title2.bold())
                        Spacer()
                        Text("\(store.parties.filter(\.isOpen).count)개 모집 중").font(.subheadline).foregroundStyle(.secondary)
                    }
                    if store.parties.isEmpty {
                        ContentUnavailableView("아직 파티가 없어요", systemImage: "car.side", description: Text("첫 택시팟을 만들어 보세요."))
                    } else {
                        ForEach(store.parties) { party in
                            Button { selectedParty = party } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack { Text(party.isOpen ? "모집 중" : "모집 마감").font(.caption.bold()).foregroundStyle(party.isOpen ? .orange : .secondary); Spacer(); Text(party.departure.koreanDate).font(.caption).foregroundStyle(.secondary) }
                                    Text(party.title).font(.headline).foregroundStyle(.primary)
                                    Text("📍 \(party.meeting.note.isEmpty ? "지도에서 집결지 확인" : party.meeting.note)").font(.subheadline).foregroundStyle(.secondary)
                                    Text("\(party.members.count) / \(party.seats)명").font(.caption.weight(.semibold)).foregroundStyle(.primary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                            }.buttonStyle(.plain)
                        }
                    }
                }.padding(20)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(store.user?.name ?? "닉네임 설정", systemImage: "person.crop.circle") { showingProfile = true } }
                ToolbarItem(placement: .topBarTrailing) { Button("서버", systemImage: "gearshape") { showingSettings = true } }
            }
            .safeAreaInset(edge: .bottom) {
                Button { if store.user == nil { showingProfile = true } else { showingCreate = true } } label: { Label("새 파티 만들기", systemImage: "plus").frame(maxWidth: .infinity).padding(15) }
                    .buttonStyle(.borderedProminent).tint(.orange).padding(.horizontal, 20).padding(.vertical, 10)
                    .background(.ultraThinMaterial)
            }
            .sheet(item: $selectedParty) { PartyDetailView(store: store, original: $0) }
            .sheet(isPresented: $showingCreate) { CreatePartyView(store: store) }
            .sheet(isPresented: $showingProfile) { ProfileView(store: store) }
            .sheet(isPresented: $showingSettings) { SettingsView(store: store) }
            .partyErrorAlert(store)
            .task { await store.load() }
            .onChange(of: store.region) { _, region in camera = .region(.init(center: region.center, latitudinalMeters: 2400, longitudinalMeters: 2400)) }
            .onOpenURL { url in
                guard url.host == "kakaolink", let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                      let partyID = parts.queryItems?.first(where: { $0.name == "party" })?.value,
                      let regionName = parts.queryItems?.first(where: { $0.name == "region" })?.value,
                      let region = Region(rawValue: regionName) else { return }
                Task { await store.changeRegion(region); selectedParty = store.parties.first(where: { $0.id == partyID }) }
            }
            .refreshable { try? await store.refresh() }
        }
    }
}

private struct ProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PartyStore
    @State private var name = ""
    var body: some View {
        NavigationStack {
            Form {
                TextField("닉네임 (2~12자)", text: $name).textInputAutocapitalization(.never)
                Button("시작하기") {
                    Task { do { try await store.signIn(name); dismiss() } catch { store.error = error.localizedDescription } }
                }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                Text("현재는 닉네임으로 참여합니다. 학교 재학생 인증은 아직 제공하지 않습니다.").font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("닉네임 설정").toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .onAppear { name = store.user?.name ?? "" }
            .partyErrorAlert(store)
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
                    Button("서버 주소 저장") { Task { await store.setServer(address); dismiss() } }
                }
                Text("시뮬레이터에서는 Mac에서 npm start를 실행한 뒤 기본 주소를 사용할 수 있습니다. 실제 iPhone에서는 배포한 HTTPS 서버 주소가 필요합니다.")
                    .font(.footnote).foregroundStyle(.secondary)
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
            Form {
                Section("파티 정보") {
                    TextField("파티 제목", text: $title)
                    DatePicker("출발 시간", selection: $departure, in: Date.now.addingTimeInterval(900)...Date.now.addingTimeInterval(14 * 86_400))
                    Picker("정원", selection: $seats) { ForEach(2...4, id: \.self) { Text("\($0)명").tag($0) } }
                }
                Section("\(store.region.name)에서 만날 위치") {
                    MapReader { proxy in
                        Map(position: $camera) { Annotation("집결지", coordinate: point) { Image(systemName: "mappin.circle.fill").font(.largeTitle).foregroundStyle(.orange) } }
                            .simultaneousGesture(SpatialTapGesture().onEnded { tap in
                                if let coordinate = proxy.convert(tap.location, from: .local) { point = coordinate }
                            })
                    }
                    .frame(height: 230).listRowInsets(EdgeInsets())
                    Text("지도를 눌러 핀을 옮겨 주세요. \(store.region.name) 중심에서 1.2km 안에서 선택할 수 있습니다.").font(.footnote).foregroundStyle(.secondary)
                    TextField("집결지 설명 (예: 3번 출구 앞)", text: $note)
                }
                Button(saving ? "만드는 중…" : "파티 만들기") {
                    saving = true
                    Task {
                        do {
                            _ = try await store.create(title: title, departure: departure, seats: seats, meeting: Meeting(lat: point.latitude, lng: point.longitude, note: note))
                            dismiss()
                        } catch { store.error = error.localizedDescription }
                        saving = false
                    }
                }.disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
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
    let original: Party
    @State private var fare = ""
    @State private var busy = false
    @State private var confirmCancel = false

    private var party: Party { store.parties.first(where: { $0.id == original.id }) ?? original }
    private var isHost: Bool { store.user?.id == party.members.first?.id }
    private var isMember: Bool { party.members.contains(where: { $0.id == store.user?.id }) }
    private let taxiURL = URL(string: "https://kakaomobility-website.onelink.me/cWP4/7d8f8872")!
    private let splitURL = URL(string: "https://link.kakaopay.com/t/money/please?chan=payhome_more&capg=service")!
    private var shareText: String {
        guard store.isPublicBackend, var link = URLComponents(string: store.serverAddress) else { return party.shareText }
        link.path = "/"
        link.queryItems = [URLQueryItem(name: "region", value: party.region), URLQueryItem(name: "party", value: party.id)]
        link.fragment = "find-party"
        return party.shareText + (link.url.map { "\n\($0.absoluteString)" } ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(party.title).font(.title.bold())
                    Label(party.departure.koreanDate, systemImage: "clock")
                    Label("\(party.members.count) / \(party.seats)명 · \(Region(rawValue: party.region)?.name ?? "") 출발", systemImage: "person.2")
                    Map(initialPosition: .region(.init(center: party.meeting.coordinate, latitudinalMeters: 550, longitudinalMeters: 550))) {
                        Marker(party.meeting.note.isEmpty ? "집결지" : party.meeting.note, coordinate: party.meeting.coordinate).tint(.orange)
                    }.frame(height: 210).clipShape(RoundedRectangle(cornerRadius: 18))
                    Text("📍 \(party.meeting.note.isEmpty ? "지도 핀에서 만나요" : party.meeting.note)").font(.headline)
                    Text("함께 타는 사람").font(.headline)
                    Text(party.members.map(\.name).joined(separator: " · ")).foregroundStyle(.secondary)
                    if let total = party.fare, let shares = party.shares {
                        Divider()
                        Text("총 택시비 \(total.formatted())원").font(.title3.bold())
                        ForEach(party.members.indices, id: \.self) { index in
                            HStack { Text(party.members[index].name); Spacer(); Text("\(shares[index].formatted())원").bold() }
                        }
                        if isHost {
                            Button("정산 금액 복사") { UIPasteboard.general.string = party.members.enumerated().map { "\($0.element.name): \(shares[$0.offset].formatted())원" }.joined(separator: "\n") }
                            Button("카카오페이 1/N 요청 열기") { openURL(splitURL) }
                            fareField
                        } else {
                            Text("카카오페이에서 파티장의 정산 요청을 확인해 주세요.").font(.footnote).foregroundStyle(.secondary)
                        }
                        Text("카카오페이에서 참여자와 금액을 직접 확인해야 합니다. 송금 완료는 자동 반영되지 않습니다.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Divider()
                        if isHost {
                            if party.members.count >= 2 { fareField }
                            Button("카카오 T 앱 열기") { openURL(taxiURL) }
                            Button("승차 정보 복사") { UIPasteboard.general.string = party.shareText + "\n집결지: \(party.meeting.lat), \(party.meeting.lng)\n목적지: 상명대학교" }
                            Button("파티 취소", role: .destructive) { confirmCancel = true }
                        } else if isMember {
                            Button("파티 나가기", role: .destructive) { Task { await act("leave") } }
                        } else if party.isOpen {
                            Button("이 파티 참여하기") { Task { await act("join") } }
                                .buttonStyle(.borderedProminent).tint(.orange)
                                .disabled(store.user == nil || busy)
                            if store.user == nil { Text("먼저 닉네임을 설정해 주세요.").font(.footnote).foregroundStyle(.secondary) }
                        }
                        if store.isPublicBackend && !KakaoShare.key.isEmpty {
                            Button("카카오톡으로 파티 공유") { KakaoShare.send(party) { store.error = $0 } }
                        }
                        ShareLink("파티 정보 공유", item: shareText)
                        Text("카카오 T 앱에서 출발지·목적지·시간을 직접 입력하고 예약을 완료해야 합니다.").font(.footnote).foregroundStyle(.secondary)
                    }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("파티 상세").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
            .confirmationDialog("파티를 취소할까요?", isPresented: $confirmCancel) { Button("파티 취소", role: .destructive) { Task { await act("cancel") } } }
            .partyErrorAlert(store)
        }
    }

    private var fareField: some View {
        HStack {
            TextField("총 택시비 (원)", text: $fare).keyboardType(.numberPad)
            Button(party.fare == nil ? "1/N 계산" : "금액 수정") {
                guard let amount = Int(fare) else { return }
                Task { await act("fare", fare: amount) }
            }.disabled(Int(fare) == nil || busy)
        }
    }

    private func act(_ action: String, fare: Int? = nil) async {
        busy = true
        do { try await store.act(action, on: party, fare: fare); if action == "cancel" { dismiss() } }
        catch { store.error = error.localizedDescription }
        busy = false
    }
}

private extension View {
    func partyErrorAlert(_ store: PartyStore) -> some View {
        alert("확인해 주세요", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("확인", role: .cancel) { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
}
