package netdisk

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

func allowedPlatform(p string) bool {
	switch p {
	case "115", "aliyun", "baidu", "cmcc", "pan123", "quark", "tianyi", "uc", "xunlei":
		return true
	}
	return false
}
func obj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func str(v any) string         { s, _ := v.(string); return s }
func num(v any) float64        { n, _ := v.(float64); return n }
func eq(v any, n float64) bool { x, ok := v.(float64); return ok && x == n }
func (m *Manager) request(ctx context.Context, method, target string, body any, headers map[string]string) (int, []byte, error) {
	var b []byte
	if s, ok := body.(string); ok {
		b = []byte(s)
	} else if body != nil {
		b, _ = json.Marshal(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(b))
	if err != nil {
		return 0, nil, errors.New("request failed")
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "application/json;charset=UTF-8")
	req.Header.Set("Accept-Language", "en,zh-CN;q=0.9,zh;q=0.8")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	// Vendor adapters never follow user or upstream redirects, nor forward credentials to another origin.
	client := *m.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := client.Do(req)
	if err != nil {
		return 0, nil, errors.New("request failed")
	}
	defer res.Body.Close()
	var reader io.Reader = res.Body
	switch strings.ToLower(res.Header.Get("Content-Encoding")) {
	case "gzip":
		z, e := gzip.NewReader(reader)
		if e != nil {
			return 0, nil, errors.New("invalid response")
		}
		defer z.Close()
		reader = z
	case "deflate":
		z, e := zlib.NewReader(reader)
		if e != nil {
			return 0, nil, errors.New("invalid response")
		}
		defer z.Close()
		reader = z
	}
	b, err = io.ReadAll(io.LimitReader(reader, (2<<20)+1))
	if err != nil || len(b) > 2<<20 {
		return 0, nil, errors.New("invalid response")
	}
	return res.StatusCode, b, nil
}

type cacheEntry struct {
	result   Result
	expires  time.Time
	inserted time.Time
}

// Completed results are shared in a bounded memory cache; in-flight contexts are
// independent so one user's cancellation never cancels another user's check.
func (m *Manager) check(ctx context.Context, p, raw string) Result {
	key := p + ":" + strings.TrimRight(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, raw), "/")
	now := time.Now()
	m.cacheMu.Lock()
	if entry, ok := m.cache[key]; ok && entry.expires.After(now) && ctx.Err() == nil {
		result := entry.result
		result.FromCache = true
		m.cacheMu.Unlock()
		return result
	}
	m.cacheMu.Unlock()
	result := m.checkUncached(ctx, p, raw)
	if ctx.Err() != nil {
		return result
	}
	ttl := 3 * time.Minute
	switch result.Status {
	case "valid":
		ttl = 30 * time.Minute
	case "invalid":
		ttl = 6 * time.Hour
	case "rate_limited":
		ttl = 2 * time.Minute
	}
	m.cacheMu.Lock()
	defer m.cacheMu.Unlock()
	if m.cache == nil {
		m.cache = map[string]cacheEntry{}
	}
	oldestKey := ""
	oldest := now
	for k, v := range m.cache {
		if !v.expires.After(now) {
			delete(m.cache, k)
			continue
		}
		if v.inserted.Before(oldest) {
			oldest = v.inserted
			oldestKey = k
		}
	}
	if len(m.cache) >= 3000 {
		delete(m.cache, oldestKey)
	}
	m.cache[key] = cacheEntry{result: result, expires: now.Add(ttl), inserted: now}
	return result
}

func (m *Manager) checkUncached(ctx context.Context, p, raw string) (result Result) {
	start := time.Now()
	result = Result{Status: "invalid", Reason: "链接格式无效"}
	defer func() {
		result.CheckedAt = time.Now().UnixMilli()
		result.DurationMs = time.Since(start).Milliseconds()
		if ctx.Err() != nil {
			result.Status = "unknown"
			result.Reason = "请求超时或已取消"
		}
	}()
	normalized := strings.TrimRight(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, raw), "/")
	u, err := url.Parse(normalized)
	if err != nil || u.User != nil || u.Port() != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return
	}
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(host, "www.")
	id := strings.TrimPrefix(u.Path, "/s/")
	pwd := u.Query().Get("pwd")
	allowed := false
	switch p {
	case "115":
		allowed = (host == "115.com" || host == "115cdn.com" || host == "anxia.com") && strings.HasPrefix(u.Path, "/s/")
	case "aliyun":
		allowed = (host == "aliyundrive.com" || host == "alipan.com") && strings.HasPrefix(u.Path, "/s/")
	case "baidu":
		allowed = host == "pan.baidu.com" && strings.HasPrefix(u.Path, "/s/") && u.Scheme == "https"
	case "quark":
		allowed = (host == "pan.quark.cn" || host == "pan.qoark.cn") && regexp.MustCompile(`^/s/[a-zA-Z0-9]+$`).MatchString(u.Path) && u.Scheme == "https"
	case "pan123":
		allowed = regexp.MustCompile(`^123(pan|684|685|912|592|865)\.(com|cn)$`).MatchString(host) && strings.HasPrefix(u.Path, "/s/")
	case "uc":
		allowed = host == "drive.uc.cn" && strings.HasPrefix(u.Path, "/s/")
	case "xunlei":
		allowed = host == "pan.xunlei.com" && strings.HasPrefix(u.Path, "/s/")
	case "tianyi":
		allowed = host == "cloud.189.cn" || host == "h5.cloud.189.cn"
	case "cmcc":
		allowed = host == "yun.139.com" || host == "caiyun.139.com"
	}
	if !allowed || id == "" {
		return
	}
	valid := func() Result { return Result{Status: "valid"} }
	invalid := func(reason string) Result { return Result{Status: "invalid", Reason: reason} }
	limited := func() Result { return Result{Status: "rate_limited", Reason: "请求接口受限"} }
	var target, method string = "", "GET"
	var body any
	headers := map[string]string{}
	switch p {
	case "aliyun":
		target = "https://api.aliyundrive.com/adrive/v3/share_link/get_share_by_anonymous?share_id=" + url.QueryEscape(id)
		method = "POST"
		body = map[string]any{"share_id": id}
		headers["Origin"] = "https://www.alipan.com"
		headers["Referer"] = "https://www.alipan.com/"
		headers["X-Canary"] = "client=web,app=share,version=v2.3.1"
	case "115":
		pwd = u.Query().Get("password")
		if pwd == "" {
			q, _ := url.ParseQuery(u.Fragment)
			pwd = q.Get("password")
		}
		if pwd == "" {
			return invalid("缺少提取码")
		}
		target = "https://115cdn.com/webapi/share/snap?" + url.Values{"share_code": {id}, "offset": {"0"}, "limit": {"20"}, "receive_code": {pwd}, "cid": {""}}.Encode()
		headers["Referer"] = "https://115cdn.com/s/" + id + "?password=" + url.QueryEscape(pwd) + "&"
		headers["X-Requested-With"] = "XMLHttpRequest"
	case "pan123":
		target = "https://www.123pan.com/api/share/info?shareKey=" + url.QueryEscape(id)
	case "uc":
		target = "https://drive.uc.cn/s/" + url.PathEscape(id)
		headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Mobile Safari/537.36"
	case "tianyi":
		id = u.Query().Get("code")
		if id == "" && strings.HasPrefix(u.Path, "/t/") {
			id = strings.Split(strings.TrimPrefix(u.Path, "/t/"), "/")[0]
		}
		if id == "" {
			f := strings.TrimPrefix(u.Fragment, "#")
			if strings.HasPrefix(f, "/t/") {
				id = strings.Split(strings.TrimPrefix(f, "/t/"), "/")[0]
			}
		}
		if id == "" {
			return
		}
		if a := regexp.MustCompile(`[（(]访问码[：:]([a-zA-Z0-9]+)[）)]`).FindStringSubmatch(normalized); len(a) > 1 {
			id += "（访问码：" + a[1] + "）"
		}
		target = "https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?noCache=" + strconv.FormatInt(time.Now().UnixNano(), 10) + "&shareCode=" + url.QueryEscape(id)
		headers["Referer"] = normalized
		headers["Sign-Type"] = "1"
	case "baidu":
		short := id
		if len(short) > 1 {
			short = short[1:]
		}
		if pwd != "" {
			s, b, e := m.request(ctx, "POST", "https://pan.baidu.com/share/verify?"+url.Values{"surl": {short}, "pwd": {pwd}}.Encode(), "pwd="+url.QueryEscape(pwd)+"&vcode=&vcode_str=", map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Referer": normalized})
			var d map[string]any
			if e != nil || s != 200 || json.Unmarshal(b, &d) != nil {
				return invalid("验证提取码请求失败")
			}
			if !eq(d["errno"], 0) {
				return invalid("验证提取码失败")
			}
			if token := str(d["randsk"]); token != "" {
				headers["Cookie"] = "BDCLND=" + token
			}
		}
		target = "https://pan.baidu.com/share/list?web=5&app_id=250528&desc=1&showempty=0&page=1&num=20&order=time&shorturl=" + url.QueryEscape(short) + "&root=1&view_mode=1&channel=chunlei&web=1&clienttype=0"
	case "quark":
		s, b, e := m.request(ctx, "POST", "https://drive-h.quark.cn/1/clouddrive/share/sharepage/token", map[string]any{"pwd_id": id, "passcode": pwd, "support_visit_limit_private_share": true}, map[string]string{"Origin": "https://pan.quark.cn", "Referer": "https://pan.quark.cn/"})
		var d map[string]any
		if e != nil || s != 200 || json.Unmarshal(b, &d) != nil {
			return invalid("Token API请求失败")
		}
		if !eq(d["status"], 200) || !eq(d["code"], 0) {
			return invalid("分享链接失效或不存在")
		}
		token := str(obj(d["data"])["stoken"])
		if token == "" {
			return invalid("分享链接无效：未获取到访问令牌")
		}
		target = "https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=" + url.QueryEscape(id) + "&stoken=" + url.QueryEscape(token) + "&ver=2&pr=ucpro"
		headers["Origin"] = "https://pan.quark.cn"
		headers["Referer"] = "https://pan.quark.cn/"
	case "cmcc":
		a := regexp.MustCompile(`https://(?:yun\.139\.com/shareweb/#/w/i/|caiyun\.139\.com/m/i\?)([^&]+)`).FindStringSubmatch(normalized)
		if len(a) < 2 {
			return
		}
		data := map[string]any{"getOutLinkInfoReq": map[string]any{"account": "", "linkID": a[1], "passwd": "", "caSrt": 1, "coSrt": 1, "srtDr": 0, "bNum": 1, "pCaID": "root", "eNum": 200}, "commonAccountInfo": map[string]any{"account": "", "accountType": 1}}
		plain, _ := json.Marshal(data)
		encrypted, e := cmccEncrypt(plain)
		if e != nil {
			return invalid("检测失败")
		}
		b, _ := json.Marshal(encrypted)
		body = string(b)
		method = "POST"
		target = "https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6"
		headers["hcy-cool-flag"] = "1"
		headers["x-deviceinfo"] = "||3|12.27.0|chrome|131.0.0.0|5c7c68368f048245e1ce47f1c0f8f2d0||windows 10|1536X695|zh-CN|||"
	case "xunlei":
		token := m.captcha(ctx)
		target = "https://api-pan.xunlei.com/drive/v1/share?" + url.Values{"share_id": {id}, "pass_code": {pwd}, "limit": {"100"}, "pass_code_token": {""}, "page_token": {""}, "thumbnail_size": {"SIZE_SMALL"}}.Encode()
		headers["Origin"] = "https://pan.xunlei.com"
		headers["Referer"] = "https://pan.xunlei.com/"
		headers["X-Client-Id"] = xClient
		headers["X-Device-Id"] = xDevice
		headers["Accept-Encoding"] = "gzip, deflate"
		if token != "" {
			headers["X-Captcha-Token"] = token
		}
	}
	s, b, e := m.request(ctx, method, target, body, headers)
	if e != nil {
		if p == "pan123" || p == "uc" {
			return valid()
		}
		return invalid("检测请求失败")
	}
	if p == "pan123" && s != 200 {
		return valid()
	}
	if p == "aliyun" && s == 429 {
		return limited()
	}
	var d map[string]any
	if p == "cmcc" && s == 200 {
		b, e = cmccDecrypt(strings.TrimSpace(string(b)))
		if e != nil {
			return invalid("检测响应无效")
		}
	}
	if p == "uc" {
		if s != 200 {
			return invalid(fmt.Sprintf("HTTP状态码: %d", s))
		}
		text := string(b)
		for _, word := range []string{"失效", "不存在", "违规", "删除", "已过期", "被取消"} {
			if strings.Contains(text, word) {
				return invalid("链接已失效")
			}
		}
		if strings.Contains(text, "文件") || strings.Contains(text, "分享") {
			return valid()
		}
		return invalid("无法判断链接有效性")
	}
	e = json.Unmarshal(b, &d)
	if s != 200 {
		if p == "xunlei" && eq(d["error_code"], 9) {
			return limited()
		}
		return invalid(fmt.Sprintf("API返回错误状态码: %d", s))
	}
	if e != nil {
		if p == "pan123" {
			return valid()
		}
		return invalid("检测响应无效")
	}
	switch p {
	case "aliyun":
		return valid()
	case "pan123":
		if eq(d["code"], 0) || obj(d["data"])["HasPwd"] == true {
			return valid()
		}
	case "baidu":
		if eq(d["errno"], 0) {
			return valid()
		}
		if eq(d["errno"], -62) {
			return limited()
		}
	case "115":
		if d["state"] == true && eq(d["errno"], 0) {
			data := obj(d["data"])
			state := num(data["share_state"])
			if state == 0 {
				state = num(obj(data["shareinfo"])["share_state"])
			}
			if state == 1 {
				return valid()
			}
		}
	case "quark":
		if list, ok := obj(d["data"])["list"].([]any); ok && len(list) > 0 {
			return valid()
		}
		return invalid("分享链接无效：文件列表为空")
	case "tianyi":
		if num(d["shareId"]) > 0 {
			return valid()
		}
	case "cmcc":
		if d["resultCode"] == "0" && d["data"] != nil {
			return valid()
		}
	case "xunlei":
		if d["share_status"] == "OK" {
			return valid()
		}
	}
	// Never expose upstream response text, which may echo tokens, extraction codes or cookies.
	for _, k := range []string{"error", "errmsg", "err_msg", "desc", "res_message", "share_status_text"} {
		s := str(d[k])
		for _, pattern := range []string{"频率限制", "请求过快", "风控", "rate limit", "rate_limit", "too many"} {
			if strings.Contains(strings.ToLower(s), pattern) {
				return limited()
			}
		}
	}
	return invalid("分享链接无效或已失效")
}

const cmccKey = "PVGDwmcvfs1uV3d1"

func pad(b []byte) []byte { n := 16 - len(b)%16; return append(b, bytes.Repeat([]byte{byte(n)}, n)...) }
func unpad(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, errors.New("invalid ciphertext")
	}
	n := int(b[len(b)-1])
	if n < 1 || n > 16 || n > len(b) || !bytes.Equal(b[len(b)-n:], bytes.Repeat([]byte{byte(n)}, n)) {
		return nil, errors.New("invalid ciphertext")
	}
	return b[:len(b)-n], nil
}

// The existing vendor protocol applies explicit PKCS#7 plus cipher auto-padding.
func cmccEncrypt(b []byte) (string, error) {
	block, _ := aes.NewCipher([]byte(cmccKey))
	iv := make([]byte, 16)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	b = pad(pad(b))
	out := make([]byte, len(b))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, b)
	return base64.StdEncoding.EncodeToString(append(iv, out...)), nil
}
func cmccDecrypt(s string) ([]byte, error) {
	b, e := base64.StdEncoding.DecodeString(s)
	if e != nil || len(b) < 32 || (len(b)-16)%16 != 0 {
		return nil, errors.New("invalid ciphertext")
	}
	block, _ := aes.NewCipher([]byte(cmccKey))
	out := make([]byte, len(b)-16)
	cipher.NewCBCDecrypter(block, b[:16]).CryptBlocks(out, b[16:])
	out, e = unpad(out)
	if e != nil {
		return nil, e
	}
	if len(out) > 0 && out[len(out)-1] > 0 && out[len(out)-1] <= 16 {
		return unpad(out)
	}
	return out, nil
}

const xDevice = "5505bd0cab8c9469b98e5891d9fb3e0d"
const xClient = "ZUBzD9J_XPXfn7f7"

func (m *Manager) captcha(ctx context.Context) string {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	sign := xClient + "1.10.0.2633com.xunlei.browser" + xDevice + timestamp
	for _, salt := range []string{"uWRwO7gPfdPB/0NfPtfQO+71", "F93x+qPluYy6jdgNpq+lwdH1ap6WOM+nfz8/V", "0HbpxvpXFsBK5CoTKam", "dQhzbhzFRcawnsZqRETT9AuPAJ+wTQso82mRv", "SAH98AmLZLRa6DB2u68sGhyiDh15guJpXhBzI", "unqfo7Z64Rie9RNHMOB", "7yxUdFADp3DOBvXdz0DPuKNVT35wqa5z0DEyEvf", "RBG", "ThTWPG5eC0UBqlbQ+04nZAptqGCdpv9o55A"} {
		sum := md5.Sum([]byte(sign + salt))
		sign = hex.EncodeToString(sum[:])
	}
	s, b, e := m.request(ctx, "POST", "https://xluser-ssl.xunlei.com/v1/shield/captcha/init", map[string]any{"action": "get:/drive/v1/share", "captcha_token": "", "client_id": xClient, "device_id": xDevice, "redirect_uri": "xlaccsdk01://xunlei.com/callback?state=harbor", "meta": map[string]any{"username": "", "phone_number": "", "email": "", "user_id": "0", "timestamp": timestamp, "captcha_sign": "1." + sign, "client_version": "1.10.0.2633", "package_name": "com.xunlei.browser"}}, map[string]string{"X-Device-Id": xDevice, "X-Client-Id": xClient, "X-Client-Version": "1.10.0.2633", "User-Agent": "ANDROID-com.xunlei.browser/1.10.0.2633 networkType/WIFI appid/22062 deviceName/Xiaomi_M2004j7ac deviceModel/M2004J7AC OSVersion/13 protocolVersion/301 platformVersion/10 sdkVersion/233100 Oauth2Client/0.9 (Linux 4_9_337-perf-sn-uotan-gd9d488809c3d3d) (JAVA 0)"})
	var d map[string]any
	if e != nil || s != 200 || json.Unmarshal(b, &d) != nil || str(d["url"]) != "" {
		return ""
	}
	return str(d["captcha_token"])
}
