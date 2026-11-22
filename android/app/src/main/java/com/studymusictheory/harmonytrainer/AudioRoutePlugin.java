package com.studymusictheory.harmonytrainer;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Reports the current audio output route (wired / bluetooth / usb / speaker) and changes to it. */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {
    private AudioManager am;
    private final AudioDeviceCallback cb = new AudioDeviceCallback() {
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { emit(); }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { emit(); }
    };

    @Override
    public void load() {
        am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        am.registerAudioDeviceCallback(cb, new Handler(Looper.getMainLooper()));
    }

    @Override
    protected void handleOnDestroy() {
        if (am != null) am.unregisterAudioDeviceCallback(cb);
    }

    private JSObject current() {
        String type = "speaker";
        String name = "";
        int rank = 0;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            String k = null; int r = 0;
            if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET) { k = "wired"; r = 3; }
            else if (t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_DEVICE) { k = "usb"; r = 3; }
            else if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || (android.os.Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER))) { k = "bluetooth"; r = 2; }
            if (k != null && r > rank) { rank = r; type = k; CharSequence n = d.getProductName(); name = n == null ? "" : n.toString(); }
        }
        JSObject o = new JSObject();
        o.put("type", type);
        o.put("name", name);
        return o;
    }

    private void emit() { notifyListeners("routeChange", current()); }

    @PluginMethod
    public void getRoute(PluginCall call) { call.resolve(current()); }
}
