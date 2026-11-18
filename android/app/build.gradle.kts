import java.util.Properties

plugins {
    id("com.android.application")
}

val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
val nativeKey = providers.gradleProperty("KAKAO_NATIVE_APP_KEY").orNull
    ?: localProperties.getProperty("kakao.nativeAppKey")
    ?: rootProject.file("../ios/Local.xcconfig").takeIf { it.exists() }
        ?.readLines()?.firstOrNull { it.trim().startsWith("KAKAO_NATIVE_APP_KEY =") }
        ?.substringAfter('=')?.trim().orEmpty()
val admobAppId = providers.gradleProperty("ADMOB_APP_ID").orNull
    ?: localProperties.getProperty("admob.appId").orEmpty()
val admobBannerId = providers.gradleProperty("ADMOB_BANNER_ID").orNull
    ?: localProperties.getProperty("admob.bannerId").orEmpty()
val admobInterstitialId = providers.gradleProperty("ADMOB_INTERSTITIAL_ID").orNull
    ?: localProperties.getProperty("admob.interstitialId").orEmpty()
val signingProperties = Properties().apply {
    rootProject.file("signing.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}

android {
    namespace = "com.kimsunghyun.taxipot"
    compileSdk = 36
    buildFeatures { resValues = true; buildConfig = true }

    defaultConfig {
        applicationId = "com.kimsunghyun.taxipot"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"
        resValue("string", "kakao_native_app_key", nativeKey)
        resValue("string", "admob_app_id", admobAppId.ifBlank { "ca-app-pub-3940256099942544~3347511713" })
        resValue("string", "admob_banner_id", admobBannerId)
        resValue("string", "admob_interstitial_id", admobInterstitialId)
        manifestPlaceholders["kakaoScheme"] = "kakao$nativeKey"
    }
    if (signingProperties.isNotEmpty()) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(signingProperties.getProperty("storeFile") ?: error("Missing storeFile"))
                storePassword = signingProperties.getProperty("storePassword") ?: error("Missing storePassword")
                keyAlias = signingProperties.getProperty("keyAlias") ?: error("Missing keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword") ?: error("Missing keyPassword")
            }
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("release")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.kakao.sdk:v2-user:2.26.0")
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
}
