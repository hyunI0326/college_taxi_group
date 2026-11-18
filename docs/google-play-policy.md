# 대택구 Google Play 출시 점검 (2026-11-06)

이 문서는 **Google Play 공식 정책을 기준으로 한 출시 준비 목록**입니다. 실제 Play Console 답변은 배포 시점의 앱, SDK, 운영 방식과 일치해야 합니다. Google은 Data safety 답변의 정확성과 최신 상태를 개발자에게 요구합니다. [Data safety 공식 안내](https://support.google.com/googleplay/android-developer/answer/10787469)

## 앱과 서버에서 필요한 항목

| 항목 | 대택구에 적용할 내용 | 공식 근거 |
| --- | --- | --- |
| 개인정보처리방침 | 앱 안에서 열 수 있어야 하며, Play Console에도 로그인 없이 접근 가능한 공개 URL을 넣습니다. 대택구 이름/운영자 문의 수단, 수집·이용·공유 데이터, 보호 방식, 보관·삭제 방침을 실제 처리 방식에 맞게 적습니다. | [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| 계정 삭제 | 앱 설정에서 삭제를 시작할 수 있어야 합니다. 앱을 삭제한 사람도 **앱 재설치 없이 웹에서 삭제를 요청**할 수 있는 URL이 필요합니다. 계정과 연관 데이터 삭제, 예외적으로 남기는 데이터와 사유를 설명합니다. 단순 비활성화는 삭제가 아닙니다. | [계정 삭제 요구사항과 웹 링크 FAQ](https://support.google.com/googleplay/android-developer/answer/13327111), [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| 파티·채팅 콘텐츠 | 파티 제목, 집결지 설명, 채팅은 다른 사용자에게 보이는 UGC입니다. 작성 전에 이용자 정책 동의를 받고 금지 콘텐츠/행위를 정의합니다. 앱 안에서 콘텐츠와 사용자 신고, 사용자 차단, 신고 검토와 필요한 조치를 실제 운영해야 합니다. | [User Generated Content](https://support.google.com/googleplay/android-developer/answer/9876937) |
| 아동 안전 기준 | Play Console의 Social/Dating 범주 또는 익명·무작위 채팅 앱에 해당하면 공개 CSAE 금지 기준, 앱 내 신고, CSAM 처리·법정 신고 절차, 담당 연락처가 필요합니다. 대택구의 실제 범주와 기능으로 적용 여부를 판단하고 해당되면 Console에서 자기 인증합니다. | [Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/9878809), [적용 범위 FAQ](https://support.google.com/googleplay/android-developer/answer/14747720) |
| 대상 API | 일반 휴대전화용 새 앱과 업데이트는 2026-08-31부터 Android 16, API 36 이상을 대상으로 빌드해야 합니다. | [Target API 요구사항](https://support.google.com/googleplay/android-developer/answer/11926878) |
| 동작 안정성 | 서버 오류 시 빈 화면만 나오거나 설치 후 사용할 수 없는 앱은 정책상 문제가 됩니다. 로그인, 파티 생성·참여, 지도, 채팅, 외부 앱 이동을 실제 기기에서 확인합니다. WebView라는 형식 자체보다 기능성과 안정성이 심사 대상입니다. | [Functionality, Content, and User Experience](https://support.google.com/googleplay/android-developer/answer/9898783) |

## Play Console에서 개발자가 직접 입력할 항목

- **Data safety:** 앱이 제어하는 WebView에서 외부로 전송하는 데이터도 포함하며, Kakao SDK와 웹 리소스 등 제3자 코드의 처리도 조사합니다. 현재 코드 기준으로 계정 아이디/닉네임/대학교/비밀번호 인증 정보, 선택적 Kakao 프로필 사진·이름, 파티 정보·채팅, 집결지 좌표, 택시비·분담 금액, 신고 정보 등을 검토해야 합니다. 지도에서 고른 집결지는 곧바로 기기 위치 권한으로 얻은 사용자 위치를 뜻하지는 않으므로 실제 수집 방식에 맞게 분류합니다. [Data safety 공식 안내](https://support.google.com/googleplay/android-developer/answer/10787469)
- **계정 및 데이터 삭제 URL:** 앱과 무관한 일반 홈페이지가 아닌, 대택구 계정 삭제 요청을 바로 시작할 수 있는 공개 페이지를 등록합니다. 고객지원 이메일이나 요청 양식도 허용되지만 앱 설치를 다시 요구해서는 안 됩니다. [계정 삭제 웹 리소스 FAQ](https://support.google.com/googleplay/android-developer/answer/13327111)
- **앱 액세스:** 로그인 필수 앱이므로 심사자가 언제든 재사용할 수 있는 테스트 계정, 비밀번호, 학교별 파티·채팅 검토 방법을 영어로 제공해야 합니다. Kakao 계정 없이 기본 아이디 로그인으로 주요 기능을 검토할 수 있게 하는 편이 간단합니다. [로그인 정보 제공 요구사항](https://support.google.com/googleplay/android-developer/answer/15748846)
- **대상 연령·콘텐츠 등급:** 실제 대상인 대학생 연령대를 선택하고 UGC/채팅이 있다는 점을 IARC 설문에 정확히 답합니다. 아동을 대상에 포함하면 별도의 Families 요건이 생깁니다. [대상 연령 설정](https://support.google.com/googleplay/android-developer/answer/9867159), [UGC 정책](https://support.google.com/googleplay/android-developer/answer/9876937)
- **금융 기능 선언:** 모든 게시 앱은 금융 기능 선언을 제출합니다. 대택구는 자체 송금·앱 내 구매 처리가 아니라 카카오페이 외부 앱 이동과 금액 계산만 제공하므로, 실제 배포 흐름을 보고 해당 선택지에 답해야 합니다. [금융 기능 선언](https://support.google.com/googleplay/android-developer/answer/13849271)
- **서명된 Android App Bundle:** 새 앱은 Play App Signing을 설정하고 업로드 키로 서명한 `.aab`를 업로드합니다. 현재 디버그 APK는 제출물로 쓰지 않습니다. 업로드 키는 개발자 본인이 안전하게 보관합니다. [서명 안내](https://developer.android.com/studio/publish/app-signing), [업로드 안내](https://developer.android.com/studio/publish/upload-bundle)
- **개인 개발자 계정 테스트:** 2023-11-13 이후 생성된 개인 개발자 계정이라면 프로덕션 접근 신청 전 비공개 테스트에 최소 12명이 연속 14일 참여해야 합니다. 계정 종류·생성일에 따라 적용 여부가 달라집니다. [테스트 요건](https://support.google.com/googleplay/android-developer/answer/14151465)

## 현재 코드 기준 공개 안내에 담아야 할 사실

- 자체 회원가입은 아이디, 비밀번호, 닉네임, 대학교를 처리하며, 학교는 사용자가 직접 선택합니다. 코드에는 재학 인증 절차가 없습니다. `cloud/worker.mjs`, `auth.mjs`.
- 파티 제목, 모임 위치 및 설명, 인원, 시간, 택시비와 채팅은 참여자/해당 대학교 이용자에게 표시됩니다. `cloud/worker.mjs`, `public/app.js`.
- Kakao 프로필 연결은 선택 기능이며 Kakao T 예약과 카카오페이 정산은 각 앱/서비스로 이동합니다. 대택구 서버가 실제 예약·송금 완료 결과를 받는 코드는 없습니다. `android/app/src/main/java/com/kimsunghyun/taxipot/MainActivity.kt`, `public/app.js`.
- 지도 타일은 OpenStreetMap, 웹 글꼴은 Google Fonts, Leaflet 파일은 unpkg에서 불러옵니다. 기기 위치 권한은 Android manifest에 선언되어 있지 않습니다. `public/index.html`, `public/app.js`, `android/app/src/main/AndroidManifest.xml`.

**출시 전 확인:** 정책 페이지와 삭제 경로의 실제 공개 URL, 운영 문의 수단, 신고 처리 담당/절차, Play Console Data safety·앱 액세스·대상 연령·콘텐츠 등급·금융 기능 선언, 서명된 AAB와 필요 시 비공개 테스트를 완료해야 합니다. 심사 통과는 Google의 검토 결과로만 확인됩니다.
