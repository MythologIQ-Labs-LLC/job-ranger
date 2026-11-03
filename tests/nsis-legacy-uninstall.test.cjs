// The NSIS installer removes a legacy Job Ranger install (appId com.jobranger.app) after
// installing Sojourner (appId com.mythologiq.sojourner), keeping the user's data.
// The legacy uninstall-key GUID is recomputed with electron-builder's own derivation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { UUID } = require("builder-util-runtime");

const repoRoot = path.resolve(__dirname, "..");
const LEGACY_APP_ID = "com.jobranger.app";
const LEGACY_GUID = "96a4dbef-49fd-52cb-bf74-9cfc92808aa6";

// app-builder-lib NsisTarget: guid = options.guid || UUID.v5(appInfo.id, ELECTRON_BUILDER_NS_UUID).
const nsisTarget = fs.readFileSync(require.resolve("app-builder-lib/out/targets/nsis/NsisTarget.js"), "utf8");
const namespace = nsisTarget.match(/ELECTRON_BUILDER_NS_UUID\s*=\s*[\w.]*UUID\.parse\("([0-9a-f-]{36})"\)/)?.[1];
assert.ok(namespace, "electron-builder's NSIS namespace UUID was found");
assert.match(nsisTarget, /options\.guid \|\| [\w.]*UUID\.v5\(appInfo\.id, ELECTRON_BUILDER_NS_UUID\)/, "the GUID is still derived from the appId");
const guidFor = (appId) => UUID.v5(appId, UUID.parse(namespace));
assert.equal(guidFor(LEGACY_APP_ID), LEGACY_GUID);

const builder = JSON.parse(fs.readFileSync(path.join(repoRoot, "electron-builder.json"), "utf8").replace(/^﻿/, ""));
assert.equal(builder.appId, "com.mythologiq.sojourner");
assert.notEqual(guidFor(builder.appId), LEGACY_GUID, "the new appId registers under a different key");
assert.equal(builder.nsis.guid, undefined, "no fixed guid overrides the derivation");
assert.equal(builder.nsis.include, "build/installer.nsh");
assert.equal(builder.nsis.deleteAppDataOnUninstall, false, "uninstalling never deletes user data");
assert.equal(builder.nsis.oneClick, false);
assert.equal(builder.nsis.perMachine, false);

// The Windows build config keeps the include (it spreads the base config).
const windowsConfig = require("../electron-builder.windows.cjs");
assert.equal(windowsConfig.nsis.include, "build/installer.nsh");

const script = fs.readFileSync(path.join(repoRoot, "build", "installer.nsh"), "utf8");
assert.ok(script.includes(`!define SOJOURNER_LEGACY_APP_GUID "${LEGACY_GUID}"`));
assert.ok(script.includes('"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${SOJOURNER_LEGACY_APP_GUID}"'));
assert.ok(script.includes('"Software\\${SOJOURNER_LEGACY_APP_GUID}"'), "InstallLocation comes from the legacy install key");

// Nothing is removed before the user chooses to install.
assert.doesNotMatch(script, /!macro customInit\b/);
const customInstall = script.match(/!macro customInstall\r?\n([\s\S]*?)!macroend/)?.[1];
assert.ok(customInstall, "customInstall is defined");
const hkcu = customInstall.indexOf('sojournerRemoveLegacyInstall HKCU "/currentuser"');
const hklm = customInstall.indexOf('sojournerRemoveLegacyInstall HKLM "/allusers"');
assert.ok(hkcu >= 0 && hklm > hkcu, "HKCU is checked, then HKLM");
// An all-users (HKLM) legacy install is only removed by an elevated installer; otherwise
// the person is told to remove it, instead of a surprise UAC prompt or a silent failure.
assert.match(
  customInstall,
  /\$\{If\} \$\{UAC_IsAdmin\}\s+!insertmacro sojournerRemoveLegacyInstall HKLM "\/allusers"\s+\$\{Else\}[\s\S]*?DetailPrint "An all-users Job Ranger installation is still present\. Remove it from Settings > Apps > Installed apps/,
);
for (let n = 0; n <= 9; n += 1) {
  assert.ok(customInstall.includes(`Push $R${n}`) && customInstall.includes(`Pop $R${n}`), `$R${n} is preserved`);
}
// electron-builder inserts customInstall at the end of the install section, after the files.
const installSection = fs.readFileSync(require.resolve("app-builder-lib/templates/nsis/installSection.nsh"), "utf8");
assert.ok(
  installSection.indexOf("!insertmacro customInstall") > installSection.indexOf("!insertmacro installApplicationFiles"),
  "customInstall runs after Sojourner's files are installed",
);

const remove = script.match(/!macro sojournerRemoveLegacyInstall ROOT_KEY SCOPE_FLAG\r?\n([\s\S]*?)!macroend/)?.[1];
assert.ok(remove, "the removal macro is defined");
const quiet = remove.indexOf('"QuietUninstallString"');
const plain = remove.indexOf('"UninstallString"');
assert.ok(quiet >= 0 && plain > quiet, "QuietUninstallString first, UninstallString as fallback");
const exec = remove.match(/ExecWait '([^']*)' \$R6/)?.[1];
assert.ok(exec, "the uninstaller runs through ExecWait and its exit code is read");
assert.deepEqual(exec.split(/\s+/), ['"$R1"', "$R5", "_?=$R4"], "the legacy uninstaller runs against its own folder and is waited for");
const flags = remove.match(/StrCpy \$R5 "([^"]*)"/)?.[1] ?? "";
for (const flag of ["/S", "${SCOPE_FLAG}", "--updated"]) {
  assert.ok(flags.split(/\s+/).includes(flag), `the legacy uninstaller gets ${flag}`);
}
assert.match(remove, /\$\{If\} \$R7 == "\$\{SHORTCUT_NAME\}"\s+StrCpy \$R5 "\$R5 --keep-shortcuts"/, "shortcuts sharing Sojourner's name are kept");
assert.match(remove, /DetailPrint "If Job Ranger is still open, it is closed first\."/, "closing a running Job Ranger is announced");
// Same folder: compared as normalised full paths; only the legacy app's own leftovers go.
assert.match(remove, /GetFullPathName \$R8 "\$R4"\s+GetFullPathName \$R9 "\$INSTDIR"\s+\$\{If\} \$R8 == \$R9/);
const sameFolder = remove.slice(remove.indexOf("${If} $R8 == $R9"), remove.indexOf("${ElseIf} ${FileExists}"));
const compact = sameFolder.replace(/\s+/g, " ");
assert.ok(
  compact.includes('${If} $R5 != "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" ${AndIf} ${FileExists} "$R5" Delete "$R5"'),
  "the legacy executable is deleted, never Sojourner's",
);
assert.ok(
  compact.includes('${If} $R2 != "$INSTDIR\\${UNINSTALL_FILENAME}" ${AndIf} ${FileExists} "$R2" Delete "$R2"'),
  "the legacy uninstaller is deleted, never Sojourner's",
);
assert.ok(
  compact.includes('${AndIf} $R7 != "${SHORTCUT_NAME}" Delete "$DESKTOP\\$R7.lnk" Delete "$SMPROGRAMS\\$R7.lnk"'),
  "differently named legacy shortcuts are deleted",
);
assert.match(sameFolder, /DeleteRegKey \$\{ROOT_KEY\} "\$\{SOJOURNER_LEGACY_UNINSTALL_KEY\}"\s+DeleteRegKey \$\{ROOT_KEY\} "\$\{SOJOURNER_LEGACY_INSTALL_KEY\}"/);
assert.doesNotMatch(sameFolder, /ExecWait/, "the legacy uninstaller never runs against Sojourner's own folder");
assert.match(script, /!define SOJOURNER_LEGACY_UNINSTALL_ATTEMPTS 5/);
assert.match(
  remove,
  /\$\{Do\}[\s\S]*ExecWait[\s\S]*\$\{If\} \$R3 >= \$\{SOJOURNER_LEGACY_UNINSTALL_ATTEMPTS\}[\s\S]*Sleep 1000[\s\S]*\$\{Loop\}/,
  "the legacy uninstaller is retried",
);
assert.doesNotMatch(script, /--delete-app-data|RMDir \/r|\$APPDATA|\$LOCALAPPDATA/i, "the include never deletes app data");
assert.ok([...script.matchAll(/RMDir "([^"]*)"/g)].every((match) => match[1] === "$SMPROGRAMS\\$R1"), "only the legacy Start-menu folder is removed, and only if empty");
assert.doesNotMatch(remove, /Abort|Quit/, "a failed removal never blocks the install");

console.log("NSIS legacy-uninstall config tests passed");
