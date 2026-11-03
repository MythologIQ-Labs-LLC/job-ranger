/**
 * Recovery path for a broken or stale application shell: unregister the
 * service worker and delete *only* Sojourner shell and on-demand asset caches, then reload from
 * the network. Career data in the origin-private file system is untouched.
 */
/** LEGACY: shell and on-demand cache names of builds released as Job Ranger. */
const LEGACY_CACHE_PREFIXES = ["job-ranger-shell-", "job-ranger-on-demand-"];
const APP_CACHE_PREFIXES = ["sojourner-shell-", "sojourner-on-demand-", ...LEGACY_CACHE_PREFIXES];

export async function repairAppShell(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys();
      const appCaches = names.filter((name) => APP_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)));
      await Promise.all(appCaches.map((name) => caches.delete(name)));
    }
  } finally {
    window.location.reload();
  }
}
