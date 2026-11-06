import { gt } from "../../../l10n/l10n";

/**
 * Opening a file hands it to the operating system, which then either starts the
 * app that the user assigned to this file type, or runs the file itself, when it
 * is a program. Email attachments and shared files come from strangers, so a file
 * that runs code would run *their* code on our user's computer.
 *
 * @param filename Filename with extension, as the sender gave it to us
 * @param mimeType As the sender gave it to us
 * @param filepathLocal Where the file is on our local disk. The OS would open
 *   *this* file, so its extension is the one that decides what the OS does.
 *   null, if the file isn't saved to disk yet.
 * @param content Otherwise, we read the start of `filepathLocal`
 * @returns In which way the file runs code. null = It runs none, and may be opened.
 *   undefined = We had nothing to check: no contents, and no readable file on disk.
 */
export async function checkExecutableFile(filename: string, mimeType: string, filepathLocal: string | null = null, content: Blob | null = null): Promise<ExecutableKind | null | undefined> {
  // U+202E flips the reading direction: `annex<U+202E>txt.exe` displays as `annexexe.txt`
  if (kFilenameTrickCharacters.test(filename ?? "")) {
    return ExecutableKind.disguised;
  }

  // Windows and macOS ignore dots and spaces at the end, so `evil.exe. ` starts `evil.exe`.
  let extensions = [filename, filepathLocal]
    .filter(name => !!name)
    .map(name => /\.([^.\/\\]+)$/.exec(name.toLowerCase().replace(/[\s.]+$/, ""))?.[1])
    .filter(ext => !!ext);
  let type = mimeType?.toLowerCase().split(";")[0].trim() ?? "";
  let fileType = kExecutableFileTypes.find(fileType =>
    fileType.extensions.some(ext => extensions.includes(ext)) ||
    fileType.mimeTypes.includes(type));
  if (fileType) {
    return fileType.kind;
  }

  // The sender picked filename and MIME type, but not the file contents
  if (!content) {
    return undefined; // Check again, once we have the contents
  }
  let start = new Uint8Array(await content.slice(0, kHeaderLength).arrayBuffer());
  let header = String.fromCharCode(...start);
  if (header.startsWith("\xEF\xBB\xBF")) { // Unicode byte order mark, before e.g. `#!/bin/sh`
    header = header.substring(3);
  }
  let signature = kExecutableFileHeaders.find(([marker]) => header.startsWith(marker));
  return signature ? signature[1] : null;
}

/** Why we refuse to open the file, for the end user */
export function executableMessage(kind: ExecutableKind): string {
  let what =
    kind == ExecutableKind.program ? gt`This file is a program.` :
    kind == ExecutableKind.script ? gt`This file is a script, which is a program in text form.` :
    kind == ExecutableKind.shortcut ? gt`This file is a shortcut that starts a program.` :
    kind == ExecutableKind.installer ? gt`This file installs software or settings on your computer.` :
    kind == ExecutableKind.macros ? gt`This document contains macros, which are small programs.` :
    kind == ExecutableKind.webPage ? gt`This file is a web page, which can contain hidden program code.` :
    kind == ExecutableKind.disguised ? gt`This filename hides the real type of the file.` :
    gt`This file might be dangerous.`;
  return what + " " +
    gt`It might damage your computer or steal your data, so it cannot be opened directly from here.`;
}

export enum ExecutableKind {
  program = "program",
  script = "script",
  shortcut = "shortcut",
  installer = "installer",
  macros = "macros",
  /** Opens in a browser, which runs the scripts in it, e.g. `.svg` */
  webPage = "webPage",
  /** The filename lies about the file type */
  disguised = "disguised",
}

/**
 * All file types that run code, or that make the OS or an app run code.
 *
 * Sources:
 * - Microsoft Outlook blocked attachments, "Level 1", the most complete public list
 *   <https://support.microsoft.com/en-us/office/blocked-attachments-in-outlook-434752e1-02d3-4e90-9124-8b81e49a8519>
 * - Windows `%PATHEXT%`, the extensions that Windows itself runs
 * - Gmail and Thunderbird refuse the same types
 * - macOS starts `.app`, `.command`, `.workflow` and AppleScript
 * - Linux desktops run `.desktop` files
 *
 * The MIME types are a second net: The sender picks extension and MIME type
 * independently, and often gets only one of them wrong.
 */
const kExecutableFileTypes: { kind: ExecutableKind, extensions: string[], mimeTypes: string[] }[] = [
  {
    kind: ExecutableKind.program,
    extensions: [
      // Windows
      "exe", "com", "scr", "pif", "cpl", "msc", "dll", "ocx", "sys", "drv", "vxd", "386",
      "xll", "wll", "gadget", "xbap", "fxp", "prg", "plg", "ops", "osd", "tmp",
      "vsmacros", "vsw", "webpnp", "printerexport", "shb", "shs", "xnk", "pcd", "prf", "mcf",
      // Unix and Linux
      "bin", "elf", "out", "run", "appimage", "so", "ko",
      // macOS
      "app", "action", "workflow", "command", "tool", "terminal", "osax", "dylib",
      // Cross-platform runtimes
      "jar", "jnlp", "class", "apk", "dex", "xapk", "ipa",
    ],
    mimeTypes: [
      "application/x-msdownload",
      "application/x-msdos-program",
      "application/x-dosexec",
      "application/vnd.microsoft.portable-executable",
      "application/exe",
      "application/x-exe",
      "application/x-winexe",
      "application/x-executable",
      "application/x-pie-executable",
      "application/x-sharedlib",
      "application/x-elf",
      "application/x-mach-binary",
      "application/x-java-applet",
      "application/java-archive",
      "application/x-java-archive",
      "application/java-vm",
      "application/x-java-jnlp-file",
      "application/vnd.android.package-archive",
      "application/x-itunes-ipa",
      "application/x-ms-dos-executable",
    ],
  },
  {
    kind: ExecutableKind.script,
    extensions: [
      // Windows shell and scripting host
      "bat", "cmd", "btm", "vb", "vbs", "vbe", "vbp", "bas", "js", "jse", "mjs", "cjs",
      "ws", "wsc", "wsf", "wsh", "sct", "hta",
      // PowerShell
      "ps1", "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psd1", "psdm1", "psm1",
      "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml",
      // Unix shells
      "sh", "bash", "zsh", "csh", "ksh", "fish",
      // Interpreters
      "py", "pyc", "pyo", "pyw", "pyz", "pyzw", "pl", "pm", "plx",
      "php", "php3", "php4", "php5", "php7", "phtml", "rb", "rbw", "lua", "tcl", "tk",
      "ahk", "au3", "a3x", "ps", "eps", "applescript", "scpt", "scptd",
      // Server pages, which some editors and browsers execute
      "asp", "aspx", "asx", "cgi", "jsp", "jspx", "cfm",
      // Windows help formats, which contain and run script
      "chm", "hlp", "hpj", "cnt", "grp", "htc", "its",
    ],
    mimeTypes: [
      "application/x-shellscript",
      "text/x-shellscript",
      "application/x-sh",
      "application/x-csh",
      "application/x-bat",
      "application/x-msdos-batch",
      "application/bat",
      "application/x-bsh",
      "text/javascript",
      "application/javascript",
      "application/x-javascript",
      "text/x-javascript",
      "application/ecmascript",
      "text/ecmascript",
      "text/vbscript",
      "application/x-vbs",
      "text/x-vbscript",
      "application/x-powershell",
      "application/hta",
      "application/x-hta",
      "text/x-python",
      "application/x-python",
      "application/x-python-code",
      "text/x-perl",
      "application/x-perl",
      "text/x-php",
      "application/x-php",
      "text/x-ruby",
      "application/x-ruby",
      "text/x-lua",
      "text/x-tcl",
      "application/postscript",
      "application/x-applescript",
      "text/x-applescript",
      "application/vnd.ms-htmlhelp",
      "application/mshelp",
    ],
  },
  {
    kind: ExecutableKind.shortcut,
    extensions: [
      "lnk", "url", "website", "webloc", "desktop", "directory", "scf", "glk",
      "appref-ms", "application", "settingcontent-ms", "library-ms", "search-ms",
      "job", "wsb",
      // Remote Desktop: connects to the sender's server, and can hand it the local drives and clipboard
      "rdp",
    ],
    mimeTypes: [
      "application/x-ms-shortcut",
      "application/x-mswinurl",
      "application/x-url",
      "application/x-desktop",
      "application/x-gnome-app-info",
      "text/x-uri",
      "application/internet-shortcut",
      "application/x-rdp",
      "application/rdp",
    ],
  },
  {
    kind: ExecutableKind.installer,
    extensions: [
      // Installers
      "msi", "msix", "msixbundle", "appx", "appxbundle", "msp", "mst", "msu",
      "deb", "rpm", "pkg", "mpkg", "cab", "diagcab",
      // Disk images. They mount as a drive, and the files inside then look local.
      "dmg", "iso", "img", "vhd", "vhdx", "udf",
      // System settings
      "reg", "inf", "ins", "isp", "theme", "themepack", "deskthemepack", "mobileconfig",
      // Browser extensions
      "crx", "xpi",
      // Certificates. Installing one lets the sender fake any website.
      "cer", "crt", "der", "p7b", "p7c", "pfx", "p12",
    ],
    mimeTypes: [
      "application/x-msi",
      "application/x-ms-installer",
      "application/x-msdownload-msi",
      "application/x-debian-package",
      "application/vnd.debian.binary-package",
      "application/x-rpm",
      "application/x-redhat-package-manager",
      "application/x-apple-diskimage",
      "application/x-iso9660-image",
      "application/vnd.ms-cab-compressed",
      "application/x-apple-aspen-config",
      "application/x-xpinstall",
      "application/x-chrome-extension",
      "application/x-x509-ca-cert",
      "application/x-pkcs12",
      "application/pkcs12",
    ],
  },
  {
    kind: ExecutableKind.macros,
    extensions: [
      // Office documents with macros. The `m` at the end means "macro-enabled".
      "docm", "dotm", "xlsm", "xltm", "xlam", "xla", "xlm", "xlw",
      "potm", "ppam", "ppsm", "pptm", "sldm", "wbk",
      // Excel formats that fetch external data and run commands
      "iqy", "slk", "dif",
      // Microsoft Access, which is a programming environment
      "mdb", "mda", "mde", "mdt", "mdw", "mdz", "accdb", "accda", "accde", "accdr",
      "ade", "adp", "mad", "maf", "mag", "mam", "maq", "mar", "mas", "mat", "mau", "mav", "maw",
    ],
    mimeTypes: [
      "application/vnd.ms-word.document.macroenabled.12",
      "application/vnd.ms-word.template.macroenabled.12",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.ms-excel.template.macroenabled.12",
      "application/vnd.ms-excel.addin.macroenabled.12",
      "application/vnd.ms-excel.sheet.binary.macroenabled.12",
      "application/vnd.ms-powerpoint.presentation.macroenabled.12",
      "application/vnd.ms-powerpoint.template.macroenabled.12",
      "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
      "application/vnd.ms-powerpoint.addin.macroenabled.12",
      "application/vnd.ms-access",
      "application/msaccess",
      "application/x-msaccess",
    ],
  },
  {
    // These open in a web browser, which runs the JavaScript inside them.
    // Attackers use them to build the actual malware inside the browser ("HTML smuggling"),
    // and to show a login page that looks like it came from the user's own bank.
    kind: ExecutableKind.webPage,
    extensions: ["html", "htm", "xhtml", "xht", "shtml", "dhtml", "mht", "mhtml", "svg", "svgz"],
    mimeTypes: [
      "text/html",
      "application/xhtml+xml",
      "application/x-mimearchive",
      "image/svg+xml",
      "image/svg",
    ],
  },
];

/** Direction overrides, zero-width and control characters, which make the
 * displayed filename differ from the real one */
// <copied to="../../Mail/Encryption/SMIME/SMIMEPublicKey.ts">
const kFilenameTrickCharacters = /[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/;
// </copied>

/** Long enough for the longest signature below, plus 3 bytes for UTF-8 BOM */
const kHeaderLength = 30;

/** The first bytes of file types that run code */
const kExecutableFileHeaders: [string, ExecutableKind][] = [
  ["#!", ExecutableKind.script], // Unix script
  ["#@~^", ExecutableKind.script], // Microsoft encoded JScript/VBScript
  ["%!PS", ExecutableKind.script], // PostScript is a programming language
  ["<?php", ExecutableKind.script],
  ["ITSF", ExecutableKind.script], // `.chm`, which runs script
  ["REGEDIT4", ExecutableKind.installer], // Windows registry file
  ["Windows Registry Editor", ExecutableKind.installer],
  ["\x7FELF", ExecutableKind.program], // Linux, BSD, Android
  ["MZ", ExecutableKind.program], // Windows and DOS
  ["SZDD", ExecutableKind.program], // Compressed MS-DOS program
  ["\xCA\xFE\xBA\xBE", ExecutableKind.program], // macOS universal binary, and Java
  ["\xCA\xFE\xBA\xBF", ExecutableKind.program], // macOS universal binary, 64 bit
  ["\xFE\xED\xFA\xCE", ExecutableKind.program], // macOS Mach-O
  ["\xFE\xED\xFA\xCF", ExecutableKind.program], // macOS Mach-O, 64 bit
  ["\xCE\xFA\xED\xFE", ExecutableKind.program], // macOS Mach-O, byte-swapped
  ["\xCF\xFA\xED\xFE", ExecutableKind.program], // macOS Mach-O, 64 bit, byte-swapped
  ["dex\n", ExecutableKind.program], // Android
  ["!<arch>", ExecutableKind.program], // Debian package and Unix object archive
  ["\xED\xAB\xEE\xDB", ExecutableKind.installer], // RPM package
  ["MSCF", ExecutableKind.installer], // Microsoft Cabinet, also `.diagcab`
  ["L\x00\x00\x00\x01\x14\x02\x00", ExecutableKind.shortcut], // Windows shortcut `.lnk`
  ["[Desktop Entry]", ExecutableKind.shortcut], // Linux, runs its `Exec=` line
  ["[InternetShortcut]", ExecutableKind.shortcut], // Windows
];
