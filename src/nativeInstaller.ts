import { requireOptionalNativeModule } from 'expo';

// Null in Expo Go; loaded only after EAS compiles the local Android module.
type InstallerNative = {
  isInstallPermissionGranted(): boolean;
  openInstallPermissionSettings(): Promise<void>;
  installApk(uri: string): Promise<boolean>;
};
const module = requireOptionalNativeModule<InstallerNative>('HoranovInstaller');

export const isInstallerAvailable = module !== null;
export async function canRequestInstall(): Promise<boolean> {
  return module?.isInstallPermissionGranted() ?? false;
}
export async function openInstallSettings(): Promise<void> {
  if (!module) throw new Error('Нативний інсталятор недоступний у Expo Go.');
  await module.openInstallPermissionSettings();
}
export async function launchApkInstaller(uri: string): Promise<void> {
  if (!module) throw new Error('Встановлення APK потребує Android-збірки Horanov Store.');
  await module.installApk(uri);
}
