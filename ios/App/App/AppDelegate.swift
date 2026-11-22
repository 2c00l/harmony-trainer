import UIKit
import AVFoundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AudioSessionConfig.apply()
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        AudioSessionConfig.apply()
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

/// Singing app audio session: simultaneous playback and recording, loud speaker output
/// (not the earpiece) and high-quality Bluetooth (A2DP) output
/// (voice processing is enabled by WebKit only when echo cancellation is requested).
enum AudioSessionConfig {
    static func apply() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP, .mixWithOthers])
            try s.setPreferredIOBufferDuration(0.005)
            try s.setActive(true, options: [])
        } catch {
            NSLog("Pitchline: audio session setup failed: \(error)")
        }
        fixReceiver()
    }

    /// If WebKit's capture switched output to the earpiece, move it back to the speaker.
    static func fixReceiver() {
        let s = AVAudioSession.sharedInstance()
        if s.currentRoute.outputs.contains(where: { $0.portType == .builtInReceiver }) {
            try? s.overrideOutputAudioPort(.speaker)
        }
    }
}

/// Registers app-local plugins with the Capacitor bridge.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AudioRoutePlugin())
    }
}

/// JS: AudioRoute.getRoute() → {type: 'wired'|'bluetooth'|'usb'|'speaker', name}
/// events: 'routeChange' (same shape), 'interruption' {began: Bool}
@objc(AudioRoutePlugin)
public class AudioRoutePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioRoutePlugin"
    public let jsName = "AudioRoute"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getRoute", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(mediaReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func current() -> [String: Any] {
        var type = "speaker"
        var name = ""
        for o in AVAudioSession.sharedInstance().currentRoute.outputs {
            switch o.portType {
            case .headphones, .headsetMic: type = "wired"
            case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP: type = "bluetooth"
            case .usbAudio: type = "usb"
            case .airPlay, .carAudio, .HDMI: type = "bluetooth" // external outputs with Bluetooth-like delay
            default: break
            }
            name = o.portName
        }
        return ["type": type, "name": name]
    }

    @objc func routeChanged(_ n: Notification) {
        DispatchQueue.main.async {
            AudioSessionConfig.fixReceiver()
            self.notifyListeners("routeChange", data: self.current())
        }
    }

    @objc func interrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .ended { AudioSessionConfig.apply() }
        DispatchQueue.main.async { self.notifyListeners("interruption", data: ["began": type == .began]) }
    }

    @objc func mediaReset(_ n: Notification) { AudioSessionConfig.apply() }

    @objc func getRoute(_ call: CAPPluginCall) {
        call.resolve(current())
    }
}
