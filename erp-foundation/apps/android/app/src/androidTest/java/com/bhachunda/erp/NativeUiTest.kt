package com.bhachunda.erp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.SystemClock
import android.view.MotionEvent
import java.util.concurrent.atomic.AtomicReference
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
    @Test fun generatedConsentPdfRetainsGujaratiAndPaginatesLargeOwnerLists() {
        val fields=FormFields(date="2026-10-08",survey_number="12/1",khata="0009",has="1.60.57",village_en="Bitta",village_gu="બીટા",owners=listOf("નમૂના જમીન માલિક","Sample Owner"))
        val draft=FormDraft("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",fields=fields)
        val dir=File(context.getExternalFilesDir(null),"qa");dir.mkdirs()
        listOf("consent-draft.pdf" to draft,"consent-many-owners.pdf" to draft.copy(fields=fields.copy(owners=(1..50).map{"પરીક્ષણ માલિક $it / Sample Owner $it"}))).forEach { (name,form)->
            val file=generateFormPdf(context,form,File(dir,name));assertTrue(file.length()>2000)
            android.graphics.pdf.PdfRenderer(android.os.ParcelFileDescriptor.open(file,android.os.ParcelFileDescriptor.MODE_READ_ONLY)).use{pdf->assertTrue(pdf.pageCount>=3);if(name.contains("many"))assertTrue(pdf.pageCount>3)}
            val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
            android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /sdcard/bhachunda-qa")).use{it.readBytes()}
            android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("cp ${file.absolutePath} /sdcard/bhachunda-qa/$name")).use{it.readBytes()}
        }
    }
    @Test fun consentGeneratorUsesNativeFieldsAndUnsignedDraftActions() {
        val fields=FormFields(date="2026-10-08",survey_number="12/1",khata="0009",has="1.60.57",village_en="Bitta",village_gu="બીટા",owners=listOf("નમૂના માલિક / Sample Owner"))
        val draft=FormDraft("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",fields=fields)
        val vm=ErpViewModel(context.applicationContext as android.app.Application)
        compose.setContent{ErpTheme{GeneratedFormScreen(UiState(initialLoading=false,signedIn=true,connected=true,profile=Profile(role="editor",is_active=true,approval_status="approved"),formFields=fields,formDraft=draft,formId=draft.id),vm,{_,_->},{_,_->},{})}}
        compose.onNodeWithText("Unsigned draft",useUnmergedTree=true).assertExists();compose.onNodeWithText("Save draft").performScrollTo().assertIsEnabled();compose.onNodeWithText("Save PDF to phone").performScrollTo().assertIsEnabled();compose.onNodeWithText("Print form").performScrollTo().assertIsEnabled();screenshot("native-consent-generator.png")
    }
    @Test fun completeCadGeometryIsPackagedAndRenderedNatively() {
        val geometry=parseSurveyMap(context);assertEquals(990,geometry.boundaries.size);assertEquals(1074,geometry.labels.size);assertEquals(990,geometry.boundaries.map{it.id}.toSet().size);assertTrue(geometry.bounds.width()>7000);assertTrue(geometry.bounds.height()>6800)
        compose.setContent{ErpTheme{MapScreen(UiState(initialLoading=false),{})}}
        compose.waitUntil(10000){compose.onAllNodesWithText("Fit map").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Green means consent received. Pinch to zoom; drag to pan.").assertExists();screenshot("native-full-cad-map.png")
    }

    @Test fun mapTapAndConsentColourFollowTheVisibleBoundary() {
        val geometry=parseSurveyMap(context)
        val boundary=geometry.boundaries.maxBy { boundary ->
            val iterator=android.graphics.RegionIterator(boundary.region)
            val rectangle=android.graphics.Rect()
            var area=0L
            while(iterator.next(rectangle)) area+=rectangle.width().toLong()*rectangle.height()
            area
        }
        val clicked=AtomicReference<String>()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        lateinit var view: SurveyMapView
        lateinit var received: Bitmap
        var point=0
        instrumentation.runOnMainSync {
            view=SurveyMapView(context)
            // A bitmap fixture uses a software canvas. The separate full-map test
            // exercises the app's hardware-rendered Android view with all 990 paths.
            view.setLayerType(android.view.View.LAYER_TYPE_SOFTWARE,null)
            view.layout(0,0,1200,1500)
            view.geometry=geometry.copy(boundaries=listOf(boundary))
            view.focus(setOf(boundary.id))
            view.statuses=mapOf(boundary.id to "received")
            view.onBoundary={clicked.set(it)}
            received=Bitmap.createBitmap(1200,1500,Bitmap.Config.ARGB_8888)
            view.draw(Canvas(received))
            val pixels=IntArray(1200*1500)
            received.getPixels(pixels,0,1200,0,0,1200,1500)
            val green=Color.rgb(119,187,142)
            point=(2405 until pixels.size-2405).firstOrNull {
                pixels[it]==green && pixels[it-2]==green && pixels[it+2]==green &&
                    pixels[it-2400]==green && pixels[it+2400]==green
            } ?: error("A received boundary must be visibly green.")
            val x=(point%1200).toFloat();val y=(point/1200).toFloat();val now=SystemClock.uptimeMillis()
            MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0).let { view.dispatchTouchEvent(it);it.recycle() }
            MotionEvent.obtain(now,now+80,MotionEvent.ACTION_UP,x,y,0).let { view.dispatchTouchEvent(it);it.recycle() }
        }
        SystemClock.sleep(450)
        instrumentation.runOnMainSync {
            assertEquals("Tapping the green boundary must return that boundary ID",boundary.id,clicked.get())
            view.statuses=mapOf(boundary.id to "pending")
            val pending=Bitmap.createBitmap(1200,1500,Bitmap.Config.ARGB_8888)
            view.draw(Canvas(pending))
            assertEquals("Pending consent must replace the received colour",Color.rgb(246,210,147),pending.getPixel(point%1200,point/1200))
            pending.recycle();received.recycle()
        }
    }
}

