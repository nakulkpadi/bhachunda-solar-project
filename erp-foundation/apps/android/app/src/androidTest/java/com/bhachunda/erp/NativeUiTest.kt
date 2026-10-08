package com.bhachunda.erp

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.junit.Assert.*
import java.io.File

class NativeUiTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun screenshot(name: String) {
        val dir=File(context.getExternalFilesDir(null),"qa");dir.mkdirs();val image=File(dir,name)
        image.outputStream().use{compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it)}
        // Gradle removes the test app after instrumentation. Keep fixture-only
        // captures outside its app directory so the runner can collect them.
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /sdcard/bhachunda-qa")).use{it.readBytes()}
        android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("cp ${image.absolutePath} /sdcard/bhachunda-qa/$name")).use{it.readBytes()}
    }
    @Test fun loginAndRegistrationAreNativeAndRequireInput() {
        compose.setContent{ErpTheme{AuthScreen(false){_,_,_,_->}}}
        compose.onNodeWithTag("auth-submit").assertIsNotEnabled();compose.onNodeWithText("Create an account").assertExists();screenshot("native-login.png")
        compose.onNodeWithText("Create an account").performScrollTo().performClick();compose.onNodeWithText("Request access").assertIsNotEnabled();compose.onNodeWithText("Use at least 12 characters. Your account stays pending until approved.").assertExists();screenshot("native-create-account.png")
    }
    @Test fun pendingAccountCannotSeeSurveyData() {
        compose.setContent{ErpTheme{ApprovalScreen(UiState(initialLoading=false,signedIn=true,email="sample@example.invalid",profile=Profile(role="editor",is_active=false,approval_status="pending")),{},{})}}
        compose.onNodeWithText("Awaiting approval").assertExists();compose.onNodeWithText("Record consent").assertDoesNotExist();screenshot("native-pending-approval.png")
    }
    @Test fun secureSessionIsEncryptedAndCanBeCleared() {
        val store=SecureSessionStore(context);store.clear();val session=Session("access-fixture","refresh-fixture",9999999999,"fixture-user","sample@example.invalid")
        try{store.write(session);assertEquals(session,store.read());val xml=File(context.applicationInfo.dataDir,"shared_prefs/encrypted_session.xml").readText();assertFalse(xml.contains("access-fixture"));assertFalse(xml.contains("refresh-fixture"));store.clear();assertNull(store.read())}finally{store.clear()}
    }
    @Test fun completeCadGeometryIsPackagedAndRenderedNatively() {
        val geometry=parseSurveyMap(context);assertEquals(990,geometry.boundaries.size);assertEquals(1074,geometry.labels.size);assertEquals(990,geometry.boundaries.map{it.id}.toSet().size);assertTrue(geometry.bounds.width()>7000);assertTrue(geometry.bounds.height()>6800)
        compose.setContent{ErpTheme{MapScreen(UiState(initialLoading=false),{})}}
        compose.waitUntil(10000){compose.onAllNodesWithText("Fit map").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Green means consent received. Pinch to zoom; drag to pan.").assertExists();screenshot("native-full-cad-map.png")
    }
}
