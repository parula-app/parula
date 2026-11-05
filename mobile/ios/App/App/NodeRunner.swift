//
//  NodeRunner.swift
//  App
//
//  (c) 2025 Mustang code
//

import Foundation
import Capacitor
import NodeMobile

@objc public class NodeRunner: NSObject {
    private static var nodeStarted = false
    private static let jpcSecretQueue = DispatchQueue(label: "NodeRunner.jpcSecret")
    private static var jpcSecret: String?
    private static var jpcSecretWaiters: [(String) -> Void] = []

    @objc public static func startNode() {
        // Prevent double-start
        guard !nodeStarted else { return }
        nodeStarted = true

        var jpcSecretPipe: [Int32] = [-1, -1]
        guard pipe(&jpcSecretPipe) == 0 else {
            print("❌ NodeRunner: could not create the pipe for the JPC secret")
            return
        }
        readJPCSecret(jpcSecretPipe[0])
        let jpcSecretWriteEnd = jpcSecretPipe[1]

        // Run on a background thread so we don’t block the UI
        DispatchQueue.global(qos: .default).async {
                // —— DEBUG: list contents of nodejs-project folder ——
                if let folderURL = Bundle.main.resourceURL?.appendingPathComponent("nodejs-project") {
                    if let items = try? FileManager.default.contentsOfDirectory(atPath: folderURL.path) {
                        print("📂 nodejs-project contains: \(items)")
                    } else {
                        print("❌ Could not read nodejs-project folder at \(folderURL.path)")
                    }
                } else {
                    print("❌ nodejs-project folder not found in bundle")
                }

                // —— attempt to find index.mjs ——
                guard let scriptPath = Bundle.main.path(
                        forResource: "index",
                        ofType: "mjs",
                        inDirectory: "nodejs-project"
                      ) else {
                    print("❌ NodeRunner: could not find index.mjs in nodejs-project")
                    return
                }
            
                let overrideDLOpenScript = "override-dlopen-paths-preload.js"
                // —— attempt to find override-dlopen-paths-preload.js ——
                guard let overrideDLOpenPath = Bundle.main.path(
                        forResource: "override-dlopen-paths-preload",
                        ofType: "js",
                        inDirectory: "nodejs-project"
                      ) else {
                    print("❌ NodeRunner: could not find override-dlopen-paths-preload.js in nodejs-project")
                    return
                }


            // Prepare argv: ["node", "-r", "<full-path-to-preload.js>", "<full-path-to-index.mjs>", "<JPC secret pipe>"]
            let args = ["node", "-r", overrideDLOpenPath, scriptPath, String(jpcSecretWriteEnd)]
            let argc = Int32(args.count)
            let argv = UnsafeMutablePointer<UnsafeMutablePointer<Int8>?>.allocate(capacity: Int(argc))
            for (i, arg) in args.enumerated() {
                argv[i] = strdup(arg)
            }

            // Launch the embedded Node.js runtime
            node_start(argc, argv)
        }
    }

    /// `index.mjs` writes the JPC secret into the pipe and closes it, once its JPC WebSocket server listens
    private static func readJPCSecret(_ pipe: Int32) {
        DispatchQueue.global(qos: .userInitiated).async {
            let handle = FileHandle(fileDescriptor: pipe, closeOnDealloc: true)
            let secret = String(decoding: (try? handle.readToEnd()) ?? Data(), as: UTF8.self)
            jpcSecretQueue.async {
                jpcSecret = secret
                for waiter in jpcSecretWaiters {
                    waiter(secret)
                }
                jpcSecretWaiters.removeAll()
            }
        }
    }

    static func whenJPCSecret(_ callback: @escaping (String) -> Void) {
        jpcSecretQueue.async {
            if let secret = jpcSecret {
                callback(secret)
                return
            }
            jpcSecretWaiters.append(callback)
        }
    }
}

@objc(JPCSecretPlugin)
public class JPCSecretPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JPCSecretPlugin"
    public let jsName = "JPCSecret"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise)
    ]

    @objc func get(_ call: CAPPluginCall) {
        NodeRunner.whenJPCSecret { secret in
            call.resolve(["secret": secret])
        }
    }
}
