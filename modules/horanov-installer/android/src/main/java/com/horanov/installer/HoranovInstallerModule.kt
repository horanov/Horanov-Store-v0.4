package com.horanov.installer

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class HoranovInstallerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HoranovInstaller")

    Function("isInstallPermissionGranted") {
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    AsyncFunction("openInstallPermissionSettings") {
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context.packageName}"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    AsyncFunction("installApk") { fileUri: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          !context.packageManager.canRequestPackageInstalls()) {
        throw IllegalStateException("Permission required: allow installs from Horanov Store")
      }
      val originalUri = Uri.parse(fileUri)
      require(originalUri.scheme == "file") { "Expected an app-private file:// URI" }
      val original = File(originalUri.path ?: throw IllegalArgumentException("Missing file path")).canonicalFile
      val filesRoot = context.filesDir.canonicalFile
      require(original.path.startsWith(filesRoot.path + File.separator)) {
        "APK must be inside the application's private files directory"
      }
      require(original.isFile && original.name.lowercase().endsWith(".apk")) { "APK does not exist" }

      // FileProvider only exposes an install copy; never share arbitrary app storage.
      val folder = File(context.cacheDir, "horanov-apk-installs")
      folder.mkdirs()
      folder.listFiles()?.filter { it.isFile && it.lastModified() < System.currentTimeMillis() - 86400000L }
        ?.forEach { it.delete() }
      val installCopy = File(folder, "horanov-${System.currentTimeMillis()}.apk")
      original.copyTo(installCopy, overwrite = false)
      val contentUri = FileProvider.getUriForFile(context,
        "${context.packageName}.horanov_apk_provider", installCopy)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        clipData = ClipData.newUri(context.contentResolver, "Horanov APK", contentUri)
      }
      context.startActivity(intent)
      true // Returns when Android installer UI is opened, not when install completes.
    }
  }
}
