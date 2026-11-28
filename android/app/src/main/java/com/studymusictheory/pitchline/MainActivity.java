package com.studymusictheory.pitchline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioRoutePlugin.class);
        super.onCreate(savedInstanceState);
        // keep the volume keys controlling media volume (our playback), not the ringer
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
    }

    @Override
    public void onResume() {
        super.onResume();
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
    }
}
