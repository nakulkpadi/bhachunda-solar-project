package com.bhachunda.erp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.gson.Gson
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SessionStore { fun read(): Session?; fun write(session: Session); fun clear() }
class SecureSessionStore(context: Context): SessionStore {
    private val prefs = context.getSharedPreferences("encrypted_session", Context.MODE_PRIVATE)
    private val alias = "bhachunda-session-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    override fun read(): Session? = try {
        prefs.getString("session", null)?.let { encoded ->
            val parts = encoded.split('.')
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))) }
            Gson().fromJson(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8), Session::class.java)
        }
    } catch (_: Exception) { clear(); null }
    override fun write(session: Session) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val bytes = cipher.doFinal(Gson().toJson(session).toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("session", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)+"."+Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) { "Could not save the secure session." }
    }
    override fun clear() { prefs.edit().clear().commit() }
}
