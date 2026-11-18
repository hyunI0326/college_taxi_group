# 대택구(대학생택시팟구함)

수도권 대학별로 택시 동승 파티를 만들고 참여하는 iPhone·Android·웹 앱입니다. 회원가입과 로그인이 필요하며, 가입 시 선택한 대학의 파티만 볼 수 있습니다. 파티장은 지도에서 집결지를 고르고, 탑승 후 총 택시비를 입력해 참여자별 금액을 계산할 수 있습니다.

현재 대학 선택은 본인 신고 방식이며 재학 증명이나 학교 이메일 인증은 제공하지 않습니다. 대학 목록은 [공공데이터포털의 대학·전문대학 정보](https://www.data.go.kr/data/15107736/standard.do)를 참고해 만든 수도권 대학 초기 목록입니다. 여러 캠퍼스는 대학 이름 하나로 묶었습니다. 이전 출발 지역별 파티 데이터는 삭제하지 않지만 새 대학별 목록에는 나타나지 않습니다.

## iPhone 앱 실행

1. Xcode에서 `ios/TaxiPot.xcodeproj`를 엽니다. iOS 17 이상을 대상으로 하며, 첫 빌드에서 Kakao iOS SDK를 Swift Package Manager로 받습니다.
2. 카카오디벨로퍼스에서 대택구 앱의 **앱 → 플랫폼 키 → 네이티브 앱 키** 설정에 iOS 번들 ID `com.kimsunghyun.taxipot`을 등록합니다. JavaScript 키와 웹 도메인은 iPhone 앱 설정에 필요하지 않습니다.
3. `cp ios/Local.xcconfig.example ios/Local.xcconfig`를 실행하고 파일의 `KAKAO_NATIVE_APP_KEY`를 발급받은 **네이티브 앱 키**로 바꿉니다. 이미 다른 번들 ID를 등록했다면 같은 파일의 `TAXIPOT_BUNDLE_ID`도 그 값과 똑같이 맞춥니다. 이 파일은 Git에 올라가지 않습니다. 키 없이도 파티 기능은 실행되지만 카카오톡 직접 공유 버튼은 표시되지 않습니다.
4. 앱을 실행합니다. 기본 서버 주소는 `https://taxipot.tight-field-ce73.workers.dev`이며, 다른 Wi-Fi나 모바일 데이터에서도 같은 파티를 봅니다.

이전에 `http://127.0.0.1:3000` 또는 `http://192.168.45.26:3000`을 저장한 iPhone도 새 빌드부터 공개 서버를 사용합니다. 다른 서버 주소를 직접 저장했다면 오른쪽 위 **서버** 설정에서 공개 주소로 바꾸세요. 기존 닉네임 세션만으로는 새 버전을 이용할 수 없으며 계정을 새로 만들어야 합니다.

## Android 앱 실행

1. Android Studio에서 [`android/`](android/)를 열고 Android SDK 36을 설치합니다. Android 8.0 이상에서 실행합니다.
2. 프로젝트의 Gradle 빌드를 실행하거나 `cd android && ./gradlew assembleDebug`를 실행합니다. 개발용 APK는 `android/app/build/outputs/apk/debug/app-debug.apk`에 생성됩니다.
3. Android 앱은 공개 HTTPS 서버의 모바일 화면을 앱 안에 표시합니다. iPhone·웹과 같은 파티 데이터를 사용하며, 지도·채팅·정산에는 인터넷이 필요합니다. 카카오 T·카카오페이 버튼은 각 앱 또는 브라우저를 엽니다.

Google Play 업로드 파일은 `cd android && ./gradlew bundleRelease`로 다시 만들며, 결과는 `android/app/build/outputs/bundle/release/app-release.aab`입니다. `android/upload-keystore.jks`와 `android/signing.properties`가 업로드 서명에 필요합니다. 두 파일은 Git에서 제외되어 있으므로 **안전한 별도 위치에 백업**하세요. 키를 잃으면 다음 버전을 같은 업로드 키로 서명할 수 없습니다. 이미 Play Console에 이 패키지의 AAB를 올린 적이 있다면 해당 앱의 기존 업로드 키를 사용해야 합니다.

## 모바일 광고

Android·iPhone 앱은 무료로 사용할 수 있고 로그인한 화면에 AdMob 배너를 표시합니다. 파티장이 탑승과 정산 요청을 마쳤다고 직접 확인한 뒤에는 전면 광고를 하루 최대 한 번 표시할 수 있습니다. 광고가 준비되지 않았으면 파티 완료만 처리합니다. 앱 내 구매 기능은 없습니다.

개발 빌드는 Google의 테스트 광고 ID를 사용합니다. Android·iOS 배포 빌드에는 각 플랫폼의 실제 AdMob 앱 ID와 배너·전면 광고 ID를 설정했습니다. 실제 수익화 전에 아래 광고 계정 설정과 테스트를 완료해야 합니다.

1. AdMob에 Android·iOS 앱과 배너·전면 광고 단위를 각각 만들고, 개인정보 및 메시지에서 필요한 동의 화면을 설정합니다. Android는 Git에서 제외된 `android/local.properties`에 `admob.appId=...`, `admob.bannerId=...`, `admob.interstitialId=...`를 추가합니다. iOS는 `ios/Local.xcconfig`에 `ADMOB_APP_ID = ...`, `ADMOB_BANNER_ID = ...`, `ADMOB_INTERSTITIAL_ID = ...`를 추가합니다. 전면 광고 단위가 비어 있으면 배포 빌드에서는 전면 광고가 표시되지 않습니다. 테스트 ID를 실제 배포에 사용하지 마세요.
2. Google Play의 데이터 보안 양식과 App Store의 앱 개인정보 항목에 AdMob SDK가 처리하는 정보를 반영합니다. 출시 전 AdMob의 최신 iOS `SKAdNetworkItems` 목록도 `ios/TaxiPot/Info.plist`에 반영합니다.

카카오 프로필 연결을 사용하려면 카카오디벨로퍼스의 기존 **네이티브 앱 키**에 Android 패키지 이름 `com.kimsunghyun.taxipot`과 이 앱의 **키 해시**를 등록합니다. Android 빌드는 `ios/Local.xcconfig`의 `KAKAO_NATIVE_APP_KEY`를 재사용합니다. iOS 설정 파일이 없다면 Git에서 제외된 `android/local.properties`에 `kakao.nativeAppKey=발급받은_네이티브_앱_키`를 추가하세요. 디버그 키 해시는 개발용 APK를 한 번 빌드한 뒤 다음 명령으로 확인할 수 있습니다. **Play 배포본은 업로드 키가 아니라 Play Console의 앱 서명 인증서 SHA-1**로 키 해시를 만들어 추가 등록해야 카카오 SDK가 작동합니다. [카카오 Android 키 해시 안내](https://developers.kakao.com/docs/en/android/getting-started)

```bash
keytool -exportcert -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android | openssl sha1 -binary | openssl base64
```

## 무료 클라우드 서버

Cloudflare Workers가 HTTPS API와 웹 앱을 제공하고 D1이 계정, 로그인 세션, 파티, 파티 채팅을 저장합니다. Mac을 켜 두거나 도메인을 구매할 필요가 없습니다. 배포된 웹 앱도 [대택구](https://taxipot.tight-field-ce73.workers.dev)에서 열립니다.

현재 계정에 `taxipot` Worker와 `taxipot` D1 데이터베이스가 생성되어 있습니다. 서버 코드를 바꾼 뒤 재배포할 때는 다음을 실행하세요. 새 계정에서 처음 배포한다면 `wrangler.jsonc`의 D1 ID를 새로 만든 데이터베이스 ID로 바꾸고 스키마를 적용해야 합니다.

```bash
npm ci
npx wrangler login
npx wrangler d1 execute DB --remote --file cloud/schema.sql
npm run cloud:deploy
```

기존 D1에서 대학별 계정 기능으로 갱신할 때는 `npx wrangler d1 execute DB --remote --file cloud/migrations/0003_university_accounts.sql`을 배포 전에 한 번 실행합니다. 가입 대학은 변경할 수 없으며, 비밀번호는 PBKDF2 해시로 저장합니다. 실제 운영 전 학교 재학생 인증과 로그인 시도 제한이 필요합니다.

Google Play 정책용 기능이 없는 기존 D1에는 `cloud/migrations/0004_play_policy.sql`과 `cloud/migrations/0005_moderation.sql`을 순서대로 한 번씩 적용합니다. 이 배포에 연결된 D1에는 적용했습니다. 신규 D1은 `cloud/schema.sql`만 적용합니다.

개발 중 같은 Wi-Fi에서 Mac 서버를 쓰려면 `HOST=0.0.0.0 npm start`를 실행하고 iPhone의 **서버** 설정에 `http://Mac의_로컬_IP:3000`을 입력하세요. 이때의 데이터는 클라우드와 별개입니다.

iPhone 앱은 MapKit으로 지도와 집결지를 보여 줍니다. 네이티브 앱 키와 공개 HTTPS 서버가 설정되면 카카오톡 파티 공유를 사용할 수 있고, 공유받은 iPhone 앱에서 해당 파티를 엽니다. 일반 공유는 공개 서버의 파티 링크를 포함합니다. 카카오 T 호출·예약과 카카오페이 1/N 요청은 각 앱으로 이동해 사용자가 직접 완료합니다.

### 카카오 프로필 연결

카카오디벨로퍼스의 대택구 앱에서 **카카오 로그인 사용 설정**을 켜고 **동의항목 → 닉네임·프로필 사진**을 설정합니다. 앱 관리 화면 상단의 숫자 **앱 ID**를 서버의 `KAKAO_APP_ID` 환경 변수로 설정합니다. 이 값은 네이티브 앱 키와 다릅니다. Cloudflare에서는 `npx wrangler secret put KAKAO_APP_ID`로 등록합니다. 기존 D1에는 `npx wrangler d1 execute taxipot --remote --file cloud/migrations/0001_session_avatar.sql`을 한 번 실행한 뒤 배포합니다. 로컬 서버는 `KAKAO_APP_ID=숫자 npm start`로 실행합니다.

계정으로 로그인한 뒤 iPhone 또는 Android 프로필 화면의 **카카오톡 프로필 연결**을 누르면 서버가 카카오 토큰의 앱 ID와 사용자 ID를 검증합니다. 액세스 토큰은 저장하지 않습니다. 연결한 사용자의 카카오 닉네임과 사진은 같은 대학의 파티 상세와 정산 화면에 표시됩니다. 사진 동의가 없으면 이름 옆에 글자 아바타를 표시합니다. **닉네임 저장**을 누르면 기존 파티의 카카오 프로필 사진도 제거됩니다. 정산 후 **정산 내역 카카오톡 공유**를 누르면 금액이 담긴 공유 화면으로 이동하며 사용자가 받을 사람 또는 기존 채팅방을 직접 선택합니다. 대택구가 파티원으로 카카오톡 그룹 채팅방을 자동 생성하지는 않습니다.

### 파티 채팅

기존 D1 데이터베이스에는 `npx wrangler d1 execute taxipot --remote --file cloud/migrations/0002_party_chat.sql`을 한 번 실행합니다. iPhone·Android·웹의 파티 상세에서 참여자만 **파티 채팅**을 열어 메시지를 읽고 보낼 수 있습니다. 열린 채팅은 3초마다 새 메시지를 확인하며, 입장 시 최근 100개를 보여 줍니다. 출발 7일 뒤에는 채팅 접근이 끝나고, 클라우드는 매일 오전 3시(KST)에 만료된 채팅을 삭제합니다. 파티를 취소하면 채팅도 함께 삭제됩니다.

## 웹 앱 실행

로컬 개발에는 Node.js 20 이상에서 다음 명령을 실행한 뒤 `http://localhost:3000`을 여세요.

```bash
npm start
```

로컬 Node 서버는 `data/taxi-pot.json`에 저장하고, 클라우드 서버는 D1에 저장합니다. 포트는 `PORT` 환경 변수로 변경할 수 있습니다. 클라우드 코드를 로컬에서 실행하려면 `npx wrangler d1 execute DB --local --file cloud/schema.sql` 다음 `npm run cloud:dev`를 사용하세요.

```bash
npm test
```

## 현재 범위

- 아이디·비밀번호로 회원가입하고 로그인합니다. 가입 시 대학과 닉네임이 필수이며 한 택시의 정원은 파티장을 포함해 2~4명입니다.
- 로그인한 사람은 본인 대학의 파티만 조회·생성·참여·채팅·정산할 수 있습니다. 지도에서 집결지를 고릅니다.
- 파티장이 총 요금을 입력하면 원 단위 나머지까지 참여 순서대로 나누어 총액과 일치시킵니다.
- 파티장은 승차 정보를 복사하고 [카카오 T 앱](https://www.kakaomobility.com/kakaot/index.html)을 열어 직접 호출·예약할 수 있습니다. 앱에서 출발지, 목적지, 시간과 예약 가능 차량을 다시 선택해야 합니다.
- 택시비를 계산한 뒤 금액을 복사하고 [카카오페이 1/N 정산](https://story.kakaopay.com/05-kakaopay-money/) 화면을 열 수 있습니다. 카카오페이에서 참여자와 금액을 직접 확인하고 요청해야 합니다. 파티원은 정산 요청 내역 화면으로 이동할 수 있습니다.
- 파티 정보는 휴대폰의 공유 메뉴로 공유할 수 있습니다. 공개 서버의 공유 링크는 해당 파티를 엽니다. 로컬 실행에서는 다른 기기에서 접속할 수 없어 텍스트만 공유합니다.
- 파티원은 iPhone·Android·웹에서 집결지와 도착 시간을 채팅할 수 있습니다.
- 대택구가 예약이나 송금을 대신 실행하거나 완료 여부를 확인하지는 않습니다. [카카오모빌리티의 공개 개발자 제품 목록](https://developers.kakaomobility.com/)에서 택시 호출·예약 API는 확인되지 않았습니다. 카카오페이 1/N 링크는 모바일에서 이용하며 정산 금액이 자동 입력되지 않습니다. 학교 재학생 인증과 실시간 알림도 포함하지 않습니다.
- 지도에는 Leaflet과 OpenStreetMap 타일을 사용하므로 지도 표시에는 인터넷 연결이 필요합니다. 지도 데이터 © OpenStreetMap contributors.

## Google Play 출시 준비

- 앱과 공개 웹의 [개인정보처리방침](https://taxipot.tight-field-ce73.workers.dev/privacy.html), [계정 삭제](https://taxipot.tight-field-ce73.workers.dev/delete-account.html), [파티 이용 규칙](https://taxipot.tight-field-ce73.workers.dev/community.html)을 확인합니다. 계정 삭제는 앱 설치 없이 웹에서 아이디와 비밀번호로 완료하거나 이메일로 요청할 수 있습니다.
- 파티와 채팅의 신고는 D1 `reports` 테이블에 저장됩니다. 운영자는 **매일** `npx wrangler d1 execute DB --remote --command "SELECT id, reporter_id, reported_id, party_id, message_id, reason, created_at FROM reports WHERE reviewed_at IS NULL ORDER BY id LIMIT 50"`로 새 신고를 확인합니다. 문제가 확인되면 해당 메시지를 `DELETE FROM messages WHERE id = 메시지ID`로 삭제하고, 파티 제목·집결지 설명은 `UPDATE parties SET data = json_set(data, '$.title', '신고로 숨김', '$.meeting.note', ''), version = version + 1 WHERE id = '파티ID'`로 숨길 수 있습니다. 필요한 경우 `UPDATE accounts SET suspended_at = strftime('%s','now') * 1000 WHERE id = '신고대상ID'`로 계정을 정지합니다. 조치를 별도 운영 기록에 남긴 뒤 `UPDATE reports SET reviewed_at = strftime('%s','now') * 1000 WHERE id = 신고ID`로 처리 표시합니다. 계정 정지는 삭제가 아니므로 삭제 요청은 계속 처리해야 합니다.
- Android Studio에서 **Build → Generate Signed App Bundle / APK → Android App Bundle**을 선택해 업로드 키로 서명된 AAB를 만듭니다. 업로드 키와 암호를 안전하게 백업하고 Play App Signing을 설정합니다. 디버그 APK나 서명되지 않은 AAB는 Play 제출물로 사용하지 않습니다.
- Play Console **App signing** 화면의 앱 서명 인증서 SHA-1을 Kakao 키 해시로 변환해 카카오디벨로퍼스 네이티브 앱 키의 Android 설정에 추가합니다. Play 설치본의 카카오 프로필 연결을 테스트합니다. [카카오 공식 안내](https://developers.kakao.com/docs/en/android/getting-started)
- Play Console에 개인정보처리방침 URL, 계정 삭제 URL, Data safety, 심사용 상시 유효한 로그인 계정, 대상 연령·콘텐츠 등급, 금융 기능 선언을 입력합니다. 신규 개인 개발자 계정의 비공개 테스트 요건은 계정 상태에 따라 확인합니다. 세부 근거와 점검 항목은 [Google Play 정책 점검](docs/google-play-policy.md)에 있습니다.
