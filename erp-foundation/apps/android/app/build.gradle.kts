import java.util.Base64
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val publicConfig = file("../../web/.env.production").readLines().filter { it.contains('=') && !it.startsWith('#') }.associate {
    it.substringBefore('=').trim() to it.substringAfter('=').trim().trim('"', '\'')
}
val apiUrl = publicConfig.getValue("VITE_SUPABASE_URL")
val publicKey = publicConfig["VITE_SUPABASE_PUBLISHABLE_KEY"] ?: publicConfig.getValue("VITE_SUPABASE_ANON_KEY")
require(apiUrl == "https://aqgnkgyhuatpwdlqueat.supabase.co") { "Unexpected project configuration" }
require(publicKey.startsWith("sb_publishable_") || (publicKey.split('.').size == 3 && String(Base64.getUrlDecoder().decode(publicKey.split('.')[1])).contains("\"role\":\"anon\""))) { "Only a public client key may be packaged" }
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
android {
    namespace = "com.bhachunda.erp"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.bhachunda.erp"
        minSdk = 26
        targetSdk = 35
        versionCode = 10001
        versionName = "1.0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SUPABASE_URL", quoted(apiUrl))
        buildConfigField("String", "PUBLIC_KEY", quoted(publicKey))
        buildConfigField("String", "WEB_URL", quoted("https://nakulkpadi.github.io/bhachunda-solar-project/index.html"))
    }
    signingConfigs {
        create("erpRelease") {
            System.getenv("APK_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = System.getenv("APK_KEYSTORE_PASSWORD")
            keyAlias = "bhachunda-erp"
            keyPassword = System.getenv("APK_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        release {
            if(System.getenv("APK_KEYSTORE")!=null) signingConfig = signingConfigs.getByName("erpRelease")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            isDebuggable = false
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
    lint { abortOnError = true }
}
val syncSurveyMap by tasks.registering(Copy::class) {
    from("../../web/public/maps/combined-villages-full.svg")
    into(layout.buildDirectory.dir("generated/erpAssets"))
    rename { "survey-map.svg" }
}
val syncConsentTemplate by tasks.registering(Copy::class) {
    from("../../../shared/consent-template.json")
    into(layout.buildDirectory.dir("generated/erpAssets"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/erpAssets"))
tasks.named("preBuild").configure { dependsOn(syncSurveyMap,syncConsentTemplate) }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.00"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.11.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

