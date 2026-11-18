package com.kimsunghyun.taxipot

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.view.View
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import com.kakao.sdk.auth.model.OAuthToken
import com.kakao.sdk.common.KakaoSdk
import com.kakao.sdk.common.model.ClientError
import com.kakao.sdk.common.model.ClientErrorCause
import com.kakao.sdk.user.UserApiClient
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private val origin = "https://taxipot.tight-field-ce73.workers.dev"
    private val host = "taxipot.tight-field-ce73.workers.dev"
    private lateinit var webView: WebView
    private lateinit var adSlot: FrameLayout
    private var adView: AdView? = null
    private var interstitialAd: InterstitialAd? = null
    private var interstitialLoading = false
    private var interstitialLoadedAt = 0L
    private var adsAllowed = false
    private var signedIn = false
    private var loginInProgress = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val nativeKey = getString(R.string.kakao_native_app_key)
        if (nativeKey.isNotBlank()) KakaoSdk.init(this, nativeKey)

        CookieManager.getInstance().setAcceptCookie(true)
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString += " TaxiPotAndroid/1.0"
            setBackgroundColor(android.graphics.Color.rgb(247, 246, 241))
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host == host) return false
                    if (uri.scheme !in listOf("https", "http", "kakaot", "kakaopay")) return true
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    catch (_: ActivityNotFoundException) { toast("연결된 앱을 열 수 없습니다.") }
                    return true
                }
            }
            addJavascriptInterface(Bridge(), "TaxiPotAndroid")
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        adSlot = FrameLayout(this).apply { visibility = View.GONE }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.WHITE)
            addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(adSlot, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener { _, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                root.setPadding(0, bars.top, 0, maxOf(bars.bottom, keyboard.bottom))
                adSlot.visibility = if (keyboard.bottom > 0) View.GONE else if (signedIn && adsAllowed && adView != null) View.VISIBLE else View.GONE
                insets
            }
        }
        setContentView(root)
        setupAds()
        loadApp(intent?.data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        loadApp(intent.data)
    }

    private fun loadApp(uri: Uri?) {
        webView.loadUrl(if (uri?.scheme == "https" && uri.host == host) uri.toString() else origin)
    }

    private fun trustedPage(): Boolean = webView.url?.let { Uri.parse(it) }
        ?.let { it.scheme == "https" && it.host == host } == true

    inner class Bridge {
        @JavascriptInterface fun kakaoReady(): Boolean = getString(R.string.kakao_native_app_key).isNotBlank()
        @JavascriptInterface fun adPrivacyOptionsRequired(): Boolean =
            UserMessagingPlatform.getConsentInformation(this@MainActivity).privacyOptionsRequirementStatus ==
                com.google.android.ump.ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        @JavascriptInterface fun setSignedIn(value: Boolean) {
            runOnUiThread { if (trustedPage()) { signedIn = value; updateAdVisibility() } }
        }
        @JavascriptInterface fun showCompletionAd(partyId: String) {
            runOnUiThread {
                if (trustedPage() && partyId.matches(Regex("[a-f0-9-]{36}"))) this@MainActivity.showCompletionAd(partyId)
            }
        }
        @JavascriptInterface fun adPrivacyOptions() {
            runOnUiThread { if (trustedPage()) UserMessagingPlatform.showPrivacyOptionsForm(this@MainActivity) { error -> if (error != null) toast(error.message) } }
        }

        @JavascriptInterface fun kakaoLogin() {
            runOnUiThread { if (trustedPage()) loginWithKakao() }
        }

        @JavascriptInterface fun copyText(value: String) {
            runOnUiThread {
                if (!trustedPage() || value.length > 2_000) return@runOnUiThread
                (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("대택구", value))
            }
        }

        @JavascriptInterface fun share(title: String, text: String, url: String) {
            runOnUiThread {
                if (!trustedPage() || title.length > 100 || text.length > 2_000) return@runOnUiThread
                val link = Uri.parse(url)
                if (link.scheme != "https" || link.host != host) return@runOnUiThread
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "$text\n$url")
                }
                startActivity(Intent.createChooser(send, title))
            }
        }
    }

    private fun setupAds() {
        val consent = UserMessagingPlatform.getConsentInformation(this)
        consent.requestConsentInfoUpdate(this, ConsentRequestParameters.Builder().build(), {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(this) { if (consent.canRequestAds()) startAds() }
            if (consent.canRequestAds()) startAds()
        }, { if (consent.canRequestAds()) startAds() })
    }

    private fun startAds() {
        if (adsAllowed) return
        adsAllowed = true
        updateAdVisibility()
    }

    private fun updateAdVisibility() {
        val shouldShow = signedIn && adsAllowed
        if (shouldShow && adView == null) {
            val unit = if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/9214589741" else getString(R.string.admob_banner_id)
            if (unit.isNotBlank()) {
                MobileAds.initialize(this)
                adView = AdView(this).apply {
                    adUnitId = unit
                    setAdSize(AdSize.getLargeAnchoredAdaptiveBannerAdSize(this@MainActivity, (resources.displayMetrics.widthPixels / resources.displayMetrics.density).toInt()))
                    loadAd(AdRequest.Builder().build())
                }
                adSlot.addView(adView)
            }
        }
        if (shouldShow) loadInterstitial()
        adSlot.visibility = if (shouldShow && adView != null) View.VISIBLE else View.GONE
        webView.evaluateJavascript("window.dispatchEvent(new Event('taxipot-ad-status'))", null)
    }

    private fun loadInterstitial() {
        if (System.currentTimeMillis() - interstitialLoadedAt >= 3_600_000) interstitialAd = null
        if (interstitialAd != null || interstitialLoading || !adsAllowed) return
        val unit = if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/1033173712" else getString(R.string.admob_interstitial_id)
        if (unit.isBlank()) return
        interstitialLoading = true
        MobileAds.initialize(this)
        InterstitialAd.load(this, unit, AdRequest.Builder().build(), object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(ad: InterstitialAd) {
                interstitialLoading = false
                interstitialAd = ad
                interstitialLoadedAt = System.currentTimeMillis()
            }
            override fun onAdFailedToLoad(error: LoadAdError) {
                interstitialLoading = false
                interstitialAd = null
            }
        })
    }

    private fun showCompletionAd(partyId: String) {
        if (System.currentTimeMillis() - interstitialLoadedAt >= 3_600_000) {
            interstitialAd = null
            loadInterstitial()
            return
        }
        val preferences = getPreferences(MODE_PRIVATE)
        val ad = interstitialAd ?: run { loadInterstitial(); return }
        if (!signedIn || !adsAllowed ||
            preferences.getString("last_interstitial_party", null) == partyId ||
            System.currentTimeMillis() - preferences.getLong("last_interstitial_at", 0) < 86_400_000) return
        interstitialAd = null
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { loadInterstitial() }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { loadInterstitial() }
        }
        preferences.edit().putString("last_interstitial_party", partyId)
            .putLong("last_interstitial_at", System.currentTimeMillis()).apply()
        ad.show(this)
    }

    override fun onResume() {
        super.onResume()
        if (signedIn && adsAllowed) loadInterstitial()
        adView?.resume()
    }

    override fun onPause() {
        adView?.pause()
        super.onPause()
    }

    private fun loginWithKakao() {
        if (loginInProgress || getString(R.string.kakao_native_app_key).isBlank()) return
        loginInProgress = true
        val callback: (OAuthToken?, Throwable?) -> Unit = { token, error ->
            if (token != null) requestProfileConsent(token)
            else { loginInProgress = false; if (error != null) toast("카카오 로그인에 실패했습니다.") }
        }
        if (UserApiClient.instance.isKakaoTalkLoginAvailable(this)) {
            UserApiClient.instance.loginWithKakaoTalk(this) { token, error ->
                if (token != null) callback(token, null)
                else if (error is ClientError && error.reason == ClientErrorCause.Cancelled) loginInProgress = false
                else UserApiClient.instance.loginWithKakaoAccount(this, callback = callback)
            }
        } else UserApiClient.instance.loginWithKakaoAccount(this, callback = callback)
    }

    private fun requestProfileConsent(token: OAuthToken) {
        UserApiClient.instance.me { user, _ ->
            val scopes = buildList {
                if (user?.kakaoAccount?.profileNicknameNeedsAgreement == true) add("profile_nickname")
                if (user?.kakaoAccount?.profileImageNeedsAgreement == true) add("profile_image")
            }
            if (scopes.isEmpty()) saveKakaoSession(token.accessToken)
            else UserApiClient.instance.loginWithNewScopes(this, scopes) { newToken, error ->
                if (newToken != null) saveKakaoSession(newToken.accessToken)
                else { loginInProgress = false; if (error != null) toast("프로필 동의를 완료하지 못했습니다.") }
            }
        }
    }

    private fun saveKakaoSession(accessToken: String) {
        val existingCookie = CookieManager.getInstance().getCookie(origin)
        Thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("$origin/api/session/kakao").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    if (!existingCookie.isNullOrBlank()) setRequestProperty("Cookie", existingCookie)
                }
                connection.outputStream.use { it.write(JSONObject().put("accessToken", accessToken).toString().toByteArray()) }
                val code = connection.responseCode
                val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                    .bufferedReader().use { it.readText() }
                if (code !in 200..299) throw IllegalStateException(JSONObject(body).optString("error", "프로필 연결에 실패했습니다."))
                val newCookie = connection.getHeaderField("Set-Cookie")
                runOnUiThread {
                    loginInProgress = false
                    if (newCookie != null) CookieManager.getInstance().setCookie(origin, newCookie) { webView.reload() }
                    else webView.reload()
                    toast("카카오 프로필을 연결했어요.")
                }
            } catch (error: Exception) {
                runOnUiThread { loginInProgress = false; toast(error.message ?: "프로필 연결에 실패했습니다.") }
            } finally { connection?.disconnect() }
        }.start()
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    @Deprecated("Use the page dialog first, then WebView history")
    override fun onBackPressed() {
        webView.evaluateJavascript("document.querySelector('dialog[open]') ? 'dialog' : document.documentElement.classList.contains('android-detail-open') ? 'detail' : ''") { open ->
            when (open) {
                "\"dialog\"" -> webView.evaluateJavascript("document.querySelector('dialog[open]').close()", null)
                "\"detail\"" -> webView.evaluateJavascript("document.querySelector('.detail-close').click()", null)
                else -> if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        adView?.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
