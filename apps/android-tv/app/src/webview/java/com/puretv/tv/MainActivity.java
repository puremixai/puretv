package com.puretv.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.net.URLEncoder;

public class MainActivity extends Activity implements RemoteCommandHandler {
    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private LocalRemoteServer localRemoteServer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );

        root = new FrameLayout(this);
        setContentView(root);
        setupWebView();
        setupLocalRemoteServer();
        webView.loadUrl(withLocalRemoteHash(buildTvUrl(BuildConfig.BASE_URL)));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = new WebView(this);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();
        webView.addJavascriptInterface(new LocalRemoteBridge(), "PureTVLocalRemote");
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        settings.setUserAgentString(settings.getUserAgentString() + " PureTVAndroidTV WebView");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectLocalRemoteInfo();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                root.addView(customView, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                ));
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });
    }



    private class LocalRemoteBridge {
        @JavascriptInterface
        public String getRemoteUrl() {
            return localRemoteServer == null ? "" : String.valueOf(localRemoteServer.getRemoteUrl());
        }

        @JavascriptInterface
        public int getPort() {
            return localRemoteServer == null ? -1 : localRemoteServer.getPort();
        }

    }

    private void injectLocalRemoteInfo() {
        if (webView == null || localRemoteServer == null) return;
        String url = localRemoteServer.getRemoteUrl();
        if (url == null) return;
        String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'");
        String script = "window.__PURETV_LOCAL_REMOTE_URL='" + safeUrl + "';" +
                "window.dispatchEvent(new CustomEvent('puretv:local-remote-info',{detail:{url:'" + safeUrl + "'}}));";
        webView.evaluateJavascript(script, null);
    }

    private void setupLocalRemoteServer() {
        localRemoteServer = new LocalRemoteServer(this);
        localRemoteServer.start();
    }

    private int keyCodeForRemoteKey(String key, String digit) {
        if ("up".equals(key)) return KeyEvent.KEYCODE_DPAD_UP;
        if ("down".equals(key)) return KeyEvent.KEYCODE_DPAD_DOWN;
        if ("left".equals(key)) return KeyEvent.KEYCODE_DPAD_LEFT;
        if ("right".equals(key)) return KeyEvent.KEYCODE_DPAD_RIGHT;
        if ("ok".equals(key)) return KeyEvent.KEYCODE_DPAD_CENTER;
        if ("back".equals(key)) return KeyEvent.KEYCODE_BACK;
        if ("menu".equals(key)) return KeyEvent.KEYCODE_MENU;
        if ("home".equals(key)) return KeyEvent.KEYCODE_HOME;
        if ("playPause".equals(key)) return KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        if ("pageUp".equals(key)) return KeyEvent.KEYCODE_PAGE_UP;
        if ("pageDown".equals(key)) return KeyEvent.KEYCODE_PAGE_DOWN;
        if ("digit".equals(key) && digit != null && digit.length() == 1 && digit.charAt(0) >= '0' && digit.charAt(0) <= '9') {
            return KeyEvent.KEYCODE_0 + (digit.charAt(0) - '0');
        }
        return KeyEvent.KEYCODE_UNKNOWN;
    }


    private void dispatchLocalRemoteKey(String key, boolean repeat, String digit) {
        if (webView == null || key == null) return;
        String safeKey = key.replace("\\", "\\\\").replace("'", "\\'");
        String safeDigit = digit == null ? "" : digit.replace("\\", "\\\\").replace("'", "\\'");
        String script = "window.dispatchEvent(new CustomEvent('puretv:local-remote-key',{detail:{key:'"
                + safeKey + "',repeat:" + (repeat ? "true" : "false") + ",digit:'" + safeDigit + "'}}));";
        webView.evaluateJavascript(script, null);
    }

    @Override
    public void onRemoteKey(String key, boolean repeat, String digit) {
        mainHandler.post(() -> dispatchLocalRemoteKey(key, repeat, digit));
    }

    @Override
    public void onRemoteText(String mode, String text) {
        mainHandler.post(() -> {
            if (webView == null) return;
            String safeMode = mode == null ? "replace" : mode.replace("\\", "\\\\").replace("'", "\\'");
            String safeText = text == null ? "" : text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
            String script = "window.dispatchEvent(new CustomEvent('puretv:local-remote-text',{detail:{mode:'" + safeMode + "',text:'" + safeText + "'}}));";
            webView.evaluateJavascript(script, null);
        });
    }


    private String withLocalRemoteHash(String url) {
        String remoteUrl = localRemoteServer == null ? null : localRemoteServer.getRemoteUrl();
        if (remoteUrl == null || remoteUrl.isEmpty()) return url;
        try {
            return url + "#localRemoteUrl=" + URLEncoder.encode(remoteUrl, "UTF-8");
        } catch (Exception ignored) {
            return url;
        }
    }

    private static String buildTvUrl(String baseUrl) {
        String url = baseUrl == null ? "" : baseUrl.trim();
        if (url.isEmpty()) {
            url = "http://192.168.1.10:3000";
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        if (url.endsWith("/tv")) {
            return url;
        }
        return url + "/tv";
    }

    private void hideCustomView() {
        if (customView == null) {
            return;
        }
        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (localRemoteServer != null) {
            localRemoteServer.stop();
            localRemoteServer = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
