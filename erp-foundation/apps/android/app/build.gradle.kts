import java.util.Base64
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
// Public client configuration only. Environment variables override local files.
val androidConfigFile = rootProject.file("android.properties")
val webConfigFile = file("../../web/.env.production")
val configFile = if (androidConfigFile.exists()) androidConfigFile else webConfigFile
val publicConfig = if (configFile.exists()) configFile.readLines()
    .filter { it.contains('=') && !it.trimStart().startsWith('#') }
    .associate { it.substringBefore('=').trim() to it.substringAfter('=').trim().trim('"', '\'') }
    else emptyMap()
fun publicSetting(androidName: String, webName: String): String? =
    System.getenv(androidName)?.takeIf { it.isNotBlank() }
        ?: publicConfig[androidName]?.takeIf { it.isNotBlank() }
        ?: publicConfig[webName]?.takeIf { it.isNotBlank() }
val apiUrl = publicSetting("ERP_SUPABASE_URL", "VITE_SUPABASE_URL")
    ?: error("Set ERP_SUPABASE_URL or copy android.properties.example to android.properties")
val publicKey = publicSetting("ERP_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY")
    ?: publicSetting("ERP_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY")
    ?: error("Set a public Supabase client key; never use a service-role key")
val webUrl = publicSetting("ERP_WEB_URL", "VITE_WEB_URL")
    ?: "https://nakulkpadi.github.io/bhachunda-solar-project/index.html"
require(java.net.URI(apiUrl).let { it.scheme == "https" && !it.host.isNullOrBlank() && it.userInfo == null && it.query == null && it.fragment == null && it.path.orEmpty() in setOf("", "/") }) { "The API URL must be an HTTPS origin" }
require(java.net.URI(webUrl).let { it.scheme == "https" && !it.host.isNullOrBlank() && it.userInfo == null }) { "The web URL must use HTTPS" }
require(publicKey.startsWith("sb_publishable_") || (publicKey.split('.').size == 3 && runCatching { String(Base64.getUrlDecoder().decode(publicKey.split('.')[1])).contains("\"role\":\"anon\"") }.getOrDefault(false))) { "Only a public client key may be packaged" }
// Staging is permitted for debug builds only; production releases keep the original project.
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        require(apiUrl == "https://aqgnkgyhuatpwdlqueat.supabase.co") { "Production releases must use the original project" }
    }
}
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
        buildConfigField("String", "WEB_URL", quoted(webUrl))
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
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
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

