#!/usr/bin/env bash
# waydesk — Aşama 0: ortam keşfi.
#
# SALT OKUNUR. Hiçbir paket kurmaz, ayar değiştirmez; rapor dosyası dışında diske
# yazmaz. Portal ve Mutter D-Bus nesnelerinden yalnızca özellik (property) okur:
# ekran paylaşım oturumu AÇMAZ, izin diyaloğu çıkmaz. Tek "aktif" iş, GPU'da
# birkaç saniyelik NVENC deneme kodlamasıdır (videotestsrc → fakesink).
#
# GNOME oturumundaki bir terminalden çalıştır (SSH'tan değil, root olarak değil):
#   bash waydesk/scripts/stage0-discover.sh                  # → ~/waydesk-stage0.txt
#   bash waydesk/scripts/stage0-discover.sh /yol/rapor.txt
set -u

OUT="${1:-$HOME/waydesk-stage0.txt}"
DBUS_TIMEOUT=8
GST_TIMEOUT=30

# ---------------------------------------------------------------- yardımcılar
hdr()  { printf '\n=== %s ===\n' "$1"; }
# printf'in %-Ns'i bayt sayar; Türkçe karakterlerde hizayı korumak için karakter say.
pad()  { local s=$1 w=$2; printf '%s%*s' "$s" $(( w > ${#s} ? w - ${#s} : 0 )) ''; }
kv()   { printf '  %s %s\n' "$(pad "$1" 38)" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }

SUM_S=(); SUM_K=(); SUM_D=()
summary() { SUM_S+=("$1"); SUM_K+=("$2"); SUM_D+=("$3"); }

pkgver() {  # paket → sürüm | YOK
  local v
  v=$(dpkg-query -W -f='${db:Status-Abbrev}|${Version}\n' "$1" 2>/dev/null | head -1)
  [[ $v == ii* ]] && echo "${v#*|}" || echo "YOK"
}

isnum() { [[ ${1:-} =~ ^[0-9]+$ ]]; }

ver_ge() { [ -n "$1" ] && [ "$1" != "YOK" ] && dpkg --compare-versions "$1" ge "$2" 2>/dev/null; }

dprop() {  # dest path iface prop → değer (ilk alan) | boş
  timeout "$DBUS_TIMEOUT" busctl --user get-property "$@" 2>/dev/null | awk '{print $2}'
}

bits() {  # değer ad1 ad2 ad4 ... → set olan bitlerin adları
  local v=${1:-0} b=1 out=()
  shift
  [[ $v =~ ^[0-9]+$ ]] || { echo "?"; return; }
  for n in "$@"; do (( v & b )) && out+=("$n"); b=$((b << 1)); done
  echo "${out[*]:-yok}"
}

gst_el() {  # element → "✓ plugin sürüm (modül)" | "YOK"
  local info
  info=$(timeout "$GST_TIMEOUT" gst-inspect-1.0 "$1" 2>/dev/null) || { echo "YOK"; return 1; }
  printf '✓ %s %s (%s)\n' \
    "$(sed -n 's/^  Name[[:space:]]*//p' <<<"$info" | head -1)" \
    "$(sed -n 's/^  Version[[:space:]]*//p' <<<"$info" | head -1)" \
    "$(sed -n 's/^  Source module[[:space:]]*//p' <<<"$info" | head -1)"
}

gst_props() {  # element prop... → var olan özellikler
  local info p out=()
  info=$(timeout "$GST_TIMEOUT" gst-inspect-1.0 "$1" 2>/dev/null) || return
  for p in "${@:2}"; do grep -qE "^  ${p}[[:space:]]*:" <<<"$info" && out+=("$p"); done
  kv "  $1 özellikleri" "${out[*]:-(hiçbiri)}"
}

gst_sink_formats() {
  timeout "$GST_TIMEOUT" gst-inspect-1.0 "$1" 2>/dev/null \
    | awk '/SINK template/{f=1} /SRC template/{f=0} f && /format:/' \
    | sed 's/^[[:space:]]*/    /' | awk '!seen[$0]++' | head -4
}

gst_try() {  # "pipeline" → ✓ | ✗ (hata özeti)
  local args log rc
  read -ra args <<<"$1"
  log=$(timeout "$GST_TIMEOUT" gst-launch-1.0 -q "${args[@]}" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then echo "✓"; else echo "✗ (rc=$rc) $(tr '\n' ' ' <<<"$log" | cut -c1-220)"; fi
}

# ---------------------------------------------------------------- bölümler
main() {
  echo "waydesk Aşama 0 — ortam keşfi raporu"
  echo "tarih: $(date -Is)"

  # -------------------------------------------------------------- sistem
  hdr "Sistem"
  local os_id="" os_ver="" pretty="?"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id=${ID:-}; os_ver=${VERSION_ID:-}; pretty=${PRETTY_NAME:-?}
  fi
  kv "dağıtım" "$pretty"
  kv "kernel" "$(uname -r)"
  kv "CPU" "$(lscpu 2>/dev/null | sed -n 's/^Model name:[[:space:]]*//p' | head -1)"
  kv "RAM" "$(free -h 2>/dev/null | awk '/^Mem:/{print $2}')"
  kv "bash" "$BASH_VERSION"

  # -------------------------------------------------------------- oturum
  hdr "Oturum"
  local stype=${XDG_SESSION_TYPE:-}
  kv "XDG_SESSION_TYPE" "${stype:-(boş)}"
  kv "XDG_CURRENT_DESKTOP" "${XDG_CURRENT_DESKTOP:-(boş)}"
  kv "XDG_SESSION_DESKTOP" "${XDG_SESSION_DESKTOP:-(boş)}"
  kv "WAYLAND_DISPLAY / DISPLAY" "${WAYLAND_DISPLAY:-(boş)} / ${DISPLAY:-(boş)}"
  kv "DBUS_SESSION_BUS_ADDRESS" "$([ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] && echo var || echo YOK)"
  if [ -n "${XDG_SESSION_ID:-}" ] && have loginctl; then
    kv "loginctl" "$(loginctl show-session "$XDG_SESSION_ID" -p Type -p Remote -p Active -p Desktop 2>/dev/null | tr '\n' ' ')"
  fi
  if [ -r /etc/gdm3/custom.conf ]; then
    kv "gdm3 custom.conf" "$(grep -E '^[[:space:]]*(AutomaticLoginEnable|AutomaticLogin|WaylandEnable)[[:space:]]*=' /etc/gdm3/custom.conf | tr '\n' ' ')"
  fi
  if have gsettings; then
    kv "mutter experimental-features" "$(gsettings get org.gnome.mutter experimental-features 2>/dev/null)"
    kv "ekran kilidi (lock-enabled)" "$(gsettings get org.gnome.desktop.screensaver lock-enabled 2>/dev/null)"
    kv "boşta bekleme (idle-delay)" "$(gsettings get org.gnome.desktop.session idle-delay 2>/dev/null)"
  fi
  if [ "$stype" = "wayland" ]; then
    summary "✓" "Wayland oturumu" "XDG_SESSION_TYPE=wayland"
  else
    summary "✗" "Wayland oturumu" "XDG_SESSION_TYPE='${stype}' (GNOME oturumundaki terminalden çalıştırdın mı?)"
  fi
  if [[ ${XDG_CURRENT_DESKTOP:-} == *GNOME* ]]; then
    summary "✓" "Masaüstü GNOME" "${XDG_CURRENT_DESKTOP}"
  else
    summary "✗" "Masaüstü GNOME" "XDG_CURRENT_DESKTOP='${XDG_CURRENT_DESKTOP:-}' (COSMIC vb. ise Mutter API'si yok, plan değişir)"
  fi

  # -------------------------------------------------------------- GNOME / Mutter
  hdr "GNOME / Mutter"
  local shellv="-"
  have gnome-shell && shellv=$(gnome-shell --version 2>/dev/null)
  kv "gnome-shell" "$shellv"
  dpkg-query -W -f='${db:Status-Abbrev}|${Package} ${Version}\n' 'libmutter-*' 'mutter-common' 2>/dev/null \
    | awk -F'|' '$1 ~ /^ii/ {print "  " $2}'
  if have gnome-extensions; then
    kv "etkin GNOME eklentileri" "$(gnome-extensions list --enabled 2>/dev/null | tr '\n' ' ')"
  fi
  summary "·" "GNOME Shell" "$shellv"

  # -------------------------------------------------------------- NVIDIA
  hdr "NVIDIA"
  if have nvidia-smi; then
    kv "GPU / sürücü" "$(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null | head -1)"
  else
    kv "nvidia-smi" "YOK"
  fi
  kv "nvidia_drm modülü" "$([ -d /sys/module/nvidia_drm ] && echo yüklü || echo 'yüklü değil')"
  kv "nvidia_drm modeset" "$(cat /sys/module/nvidia_drm/parameters/modeset 2>/dev/null || echo '-')"
  if have system76-power; then
    kv "system76-power graphics" "$(timeout 5 system76-power graphics 2>/dev/null || echo '-')"
  fi
  local card drv c cname conns
  for card in /sys/class/drm/card[0-9]; do
    [ -e "$card/device/driver" ] || continue
    drv=$(basename "$(readlink -f "$card/device/driver")")
    conns=()
    for c in "$card"-*; do
      [ "$(cat "$c/status" 2>/dev/null)" = "connected" ] || continue
      cname=${c##*/}
      conns+=("${cname#"${card##*/}"-}")
    done
    kv "${card##*/} ($drv) bağlı ekranlar" "${conns[*]:-yok}"
  done
  kv "libnvidia-encode.so.1" "$(ldconfig -p 2>/dev/null | grep -m1 -o '/[^ ]*libnvidia-encode.so.1$' || echo YOK)"
  kv "libcuda.so.1" "$(ldconfig -p 2>/dev/null | grep -m1 -o '/[^ ]*libcuda.so.1$' || echo YOK)"

  # -------------------------------------------------------------- paketler
  hdr "Paketler (dpkg)"
  local p
  for p in xdg-desktop-portal xdg-desktop-portal-gnome xdg-desktop-portal-gtk xdg-desktop-portal-cosmic \
           pipewire wireplumber gstreamer1.0-pipewire libgstreamer1.0-0 gstreamer1.0-tools \
           gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
           gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-nice \
           gir1.2-gstreamer-1.0 gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 \
           python3 python3-gi python3-aiohttp python3-dbus-next python3-evdev \
           libxkbcommon0 ydotool tailscale gnome-remote-desktop; do
    kv "$p" "$(pkgver "$p")"
  done
  dpkg-query -W -f='${db:Status-Abbrev}|${Package} ${Version}\n' 'libnvidia-encode*' 'nvidia-driver-*' 2>/dev/null \
    | awk -F'|' '$1 ~ /^ii/ {print "  " $2}' | sort -u
  local xdp_ver xdpg_ver
  xdp_ver=$(pkgver xdg-desktop-portal)
  xdpg_ver=$(pkgver xdg-desktop-portal-gnome)

  # -------------------------------------------------------------- sürümler (binary)
  hdr "Çalışan bileşen sürümleri"
  have pipewire && kv "pipewire" "$(pipewire --version 2>/dev/null | tail -1)"
  have wireplumber && kv "wireplumber" "$(wireplumber --version 2>/dev/null | tail -1)"
  have gst-inspect-1.0 && kv "gstreamer" "$(gst-inspect-1.0 --version 2>/dev/null | sed -n 's/^GStreamer //p')"
  have python3 && kv "python3" "$(python3 --version 2>&1)"

  # -------------------------------------------------------------- servisler
  hdr "systemd --user servisleri"
  local u
  for u in pipewire.service pipewire-pulse.service wireplumber.service \
           xdg-desktop-portal.service xdg-desktop-portal-gnome.service gnome-remote-desktop.service; do
    kv "$u" "$(systemctl --user is-active "$u" 2>/dev/null)"
  done

  # -------------------------------------------------------------- portal yapılandırması
  hdr "Portal yapılandırması"
  if [ -d /usr/share/xdg-desktop-portal/portals ]; then
    local b backends=()
    for b in /usr/share/xdg-desktop-portal/portals/*.portal; do [ -e "$b" ] && backends+=("${b##*/}"); done
    kv "kurulu backend'ler" "${backends[*]:-(yok)}"
    if [ -r /usr/share/xdg-desktop-portal/portals/gnome.portal ]; then
      kv "gnome.portal Interfaces" "$(sed -n 's/^Interfaces=//p' /usr/share/xdg-desktop-portal/portals/gnome.portal | tr ';' ' ')"
    fi
  fi
  local f
  for f in /usr/share/xdg-desktop-portal/*portals.conf /etc/xdg/xdg-desktop-portal/*portals.conf \
           "${XDG_CONFIG_HOME:-$HOME/.config}"/xdg-desktop-portal/*portals.conf; do
    [ -r "$f" ] || continue
    echo "  --- $f"
    grep -vE '^[[:space:]]*(#|$)' "$f" | sed 's/^/    /'
  done

  # -------------------------------------------------------------- D-Bus arayüzleri
  hdr "D-Bus: xdg-desktop-portal (frontend)"
  local P_DEST=org.freedesktop.portal.Desktop P_PATH=/org/freedesktop/portal/desktop
  local sc_front sc_src sc_cur rd_front rd_dev
  sc_front=$(dprop $P_DEST $P_PATH org.freedesktop.portal.ScreenCast version)
  sc_src=$(dprop $P_DEST $P_PATH org.freedesktop.portal.ScreenCast AvailableSourceTypes)
  sc_cur=$(dprop $P_DEST $P_PATH org.freedesktop.portal.ScreenCast AvailableCursorModes)
  rd_front=$(dprop $P_DEST $P_PATH org.freedesktop.portal.RemoteDesktop version)
  rd_dev=$(dprop $P_DEST $P_PATH org.freedesktop.portal.RemoteDesktop AvailableDeviceTypes)
  kv "ScreenCast version" "${sc_front:-YOK}"
  kv "ScreenCast AvailableSourceTypes" "${sc_src:--} ($(bits "${sc_src:-0}" monitor window virtual))"
  kv "ScreenCast AvailableCursorModes" "${sc_cur:--} ($(bits "${sc_cur:-0}" hidden embedded metadata))"
  kv "RemoteDesktop version" "${rd_front:-YOK}"
  kv "RemoteDesktop AvailableDeviceTypes" "${rd_dev:--} ($(bits "${rd_dev:-0}" keyboard pointer touchscreen))"

  hdr "D-Bus: xdg-desktop-portal-gnome (backend)"
  local G_DEST=org.freedesktop.impl.portal.desktop.gnome
  local sc_back rd_back
  sc_back=$(dprop $G_DEST $P_PATH org.freedesktop.impl.portal.ScreenCast version)
  rd_back=$(dprop $G_DEST $P_PATH org.freedesktop.impl.portal.RemoteDesktop version)
  kv "impl.ScreenCast version" "${sc_back:-YOK}"
  kv "impl.RemoteDesktop version" "${rd_back:-YOK}"

  hdr "D-Bus: Mutter doğrudan API (gnome-remote-desktop'ın kullandığı)"
  local m_rd m_rd_dev m_sc
  m_rd=$(dprop org.gnome.Mutter.RemoteDesktop /org/gnome/Mutter/RemoteDesktop org.gnome.Mutter.RemoteDesktop Version)
  m_rd_dev=$(dprop org.gnome.Mutter.RemoteDesktop /org/gnome/Mutter/RemoteDesktop org.gnome.Mutter.RemoteDesktop SupportedDeviceTypes)
  m_sc=$(dprop org.gnome.Mutter.ScreenCast /org/gnome/Mutter/ScreenCast org.gnome.Mutter.ScreenCast Version)
  kv "org.gnome.Mutter.RemoteDesktop Version" "${m_rd:-YOK}"
  kv "  SupportedDeviceTypes" "${m_rd_dev:--} ($(bits "${m_rd_dev:-0}" keyboard pointer touchscreen))"
  kv "org.gnome.Mutter.ScreenCast Version" "${m_sc:-YOK}"

  # Kalıcılık kararları
  # - ScreenCast restore_token: frontend v4+.
  # - RemoteDesktop restore_token: frontend v2+ VE backend impl v2+
  #   (xdg-desktop-portal-gnome 45.beta "Implement restoration of remote desktop sessions").
  if isnum "$sc_front" && (( sc_front >= 4 )); then
    summary "✓" "Portal ScreenCast restore_token" "frontend v${sc_front}, backend v${sc_back:-?}"
  else
    summary "✗" "Portal ScreenCast restore_token" "frontend v${sc_front:-YOK}$([ "$xdpg_ver" = "YOK" ] && echo ' (xdg-desktop-portal-gnome kurulu değil)')"
  fi
  local rd_persist="?"
  if isnum "$rd_front" && isnum "$rd_back" && (( rd_front >= 2 && rd_back >= 2 )); then
    rd_persist="✓"
  elif [ -z "$rd_front" ] || { isnum "$rd_front" && (( rd_front < 2 )); } \
       || { isnum "$rd_back" && (( rd_back < 2 )); } \
       || { [ "$xdpg_ver" != "YOK" ] && ! ver_ge "$xdpg_ver" 45; }; then
    rd_persist="✗"
  elif ver_ge "$xdpg_ver" 45 && isnum "$rd_front" && (( rd_front >= 2 )); then
    rd_persist="✓"   # backend sürümü okunamadı ama paket sürümü yeterli
  fi
  case $rd_persist in
    ✓) summary "✓" "Portal RemoteDesktop restore_token" "frontend v${rd_front}, backend v${rd_back}: izin diyaloğu bir kez çıkar" ;;
    ✗) if [ "$xdpg_ver" = "YOK" ] && [ -z "$rd_front" ]; then
         summary "✗" "Portal RemoteDesktop restore_token" "GNOME portal backend'i (xdg-desktop-portal-gnome) kurulu değil → ScreenCast/RemoteDesktop portalı hiç yok"
       else
         summary "✗" "Portal RemoteDesktop restore_token" "frontend v${rd_front:-YOK}, backend v${rd_back:-YOK}, xdp-gnome ${xdpg_ver}: DESTEKLENMİYOR → her oturum kuruluşunda izin diyaloğu"
       fi ;;
    *) summary "?" "Portal RemoteDesktop restore_token" "frontend v${rd_front:-?}, backend v${rd_back:-?}: belirsiz" ;;
  esac
  if [ -n "$m_rd" ] && [ -n "$m_sc" ]; then
    summary "✓" "Mutter doğrudan API" "RemoteDesktop v${m_rd}, ScreenCast v${m_sc} (diyalogsuz)"
  else
    summary "✗" "Mutter doğrudan API" "bulunamadı"
  fi

  # -------------------------------------------------------------- monitörler
  hdr "Monitörler (org.gnome.Mutter.DisplayConfig) — 1/2/3 varsayılan sırası: soldan sağa"
  if have python3; then
    python3 - <<'PY'
import sys
try:
    import gi
    gi.require_version("Gio", "2.0")
    from gi.repository import Gio
except Exception as e:  # noqa: BLE001
    print(f"  (python3-gi kullanılamıyor: {e})")
    sys.exit(0)
try:
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    res = bus.call_sync("org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
                        "org.gnome.Mutter.DisplayConfig", "GetCurrentState",
                        None, None, Gio.DBusCallFlags.NONE, 5000, None)
except Exception as e:  # noqa: BLE001
    print(f"  DisplayConfig okunamadı: {e}")
    sys.exit(0)

_serial, monitors, logical, props = res.unpack()
rot = {0: "yok", 1: "90°", 2: "180°", 3: "270°", 4: "flip", 5: "flip+90°", 6: "flip+180°", 7: "flip+270°"}
current = {}
for (conn, vendor, product, _ser), modes, mprops in monitors:
    mode = next((m for m in modes if m[6].get("is-current")), None)
    current[conn] = (mprops.get("display-name") or f"{vendor} {product}", mode)

print(f"  layout-mode: {props.get('layout-mode', '?')} (1=logical, 2=physical)")
rows = []
for x, y, scale, transform, primary, mons, _lprops in logical:
    for mon in mons:
        conn = mon[0]
        name, mode = current.get(conn, ("?", None))
        size = f"{mode[1]}x{mode[2]}@{mode[3]:.2f}Hz" if mode else "?"
        rows.append((x, y, conn, name, size, scale, rot.get(transform, transform), primary))
for i, (x, y, conn, name, size, scale, tr, primary) in enumerate(sorted(rows), 1):
    print(f"  [{i}] {conn:<10} {name[:30]:<30} {size:<22} ölçek={scale:g} konum=({x},{y}) "
          f"döndürme={tr}{'  BİRİNCİL' if primary else ''}")
PY
  fi

  # -------------------------------------------------------------- GStreamer
  hdr "GStreamer elementleri"
  local gst_ok=0 pw_src="YOK" nvenc_el="YOK" webrtc_el="YOK" nice_el="YOK" el r
  if have gst-inspect-1.0; then
    gst_ok=1
    for el in pipewiresrc videoconvert videoscale videorate jpegenc appsink h264parse rtph264pay \
              x264enc openh264enc nvh264enc nvcudah264enc nvautogpuh264enc nvjpegenc \
              cudaupload cudaconvert cudascale cudaconvertscale webrtcbin nicesrc; do
      r=$(gst_el "$el")
      kv "$el" "$r"
      case $el in
        pipewiresrc) pw_src=$r ;;
        nvh264enc)   nvenc_el=$r ;;
        webrtcbin)   webrtc_el=$r ;;
        nicesrc)     nice_el=$r ;;
      esac
    done
    [ "$pw_src" != "YOK" ] && gst_props pipewiresrc fd path target-object always-copy keepalive-time min-buffers max-buffers use-bufferpool
    if [ "$nvenc_el" != "YOK" ]; then
      gst_props nvh264enc preset tune rc-mode bitrate gop-size bframes zerolatency aud repeat-sequence-header
      echo "  nvh264enc sink formatları:"
      gst_sink_formats nvh264enc
    fi
  else
    kv "gst-inspect-1.0" "YOK (gstreamer1.0-tools kurulu değil)"
  fi
  summary "$([ "$pw_src" != "YOK" ] && echo ✓ || echo ✗)" "GStreamer pipewiresrc" "$pw_src"

  # -------------------------------------------------------------- işlevsel testler
  hdr "GStreamer işlevsel testler (videotestsrc → fakesink, diske yazmaz)"
  local nv_res="(atlandı)"
  if [ $gst_ok -eq 1 ] && [ "$nvenc_el" != "YOK" ]; then
    nv_res=$(gst_try "videotestsrc num-buffers=90 ! video/x-raw,format=NV12,width=2560,height=1440,framerate=60/1 ! nvh264enc ! h264parse ! fakesink")
    kv "nvh264enc NV12 2560x1440" "$nv_res"
    kv "nvh264enc BGRx doğrudan (CPU dönüşümsüz)" \
      "$(gst_try "videotestsrc num-buffers=30 ! video/x-raw,format=BGRx,width=2560,height=1440,framerate=60/1 ! nvh264enc ! fakesink")"
    if gst-inspect-1.0 --exists cudaupload 2>/dev/null && gst-inspect-1.0 --exists cudaconvert 2>/dev/null; then
      kv "BGRx → cudaupload → cudaconvert → nvh264enc" \
        "$(gst_try "videotestsrc num-buffers=30 ! video/x-raw,format=BGRx,width=2560,height=1440,framerate=60/1 ! cudaupload ! cudaconvert ! nvh264enc ! fakesink")"
    fi
    if gst-inspect-1.0 --exists nvcudah264enc 2>/dev/null; then
      kv "nvcudah264enc NV12 2560x1440" \
        "$(gst_try "videotestsrc num-buffers=30 ! video/x-raw,format=NV12,width=2560,height=1440,framerate=60/1 ! nvcudah264enc ! fakesink")"
    fi
  else
    kv "NVENC testi" "atlandı (nvh264enc yok)"
  fi
  if [ $gst_ok -eq 1 ] && gst-inspect-1.0 --exists jpegenc 2>/dev/null; then
    kv "jpegenc 1600x900" "$(gst_try "videotestsrc num-buffers=30 ! video/x-raw,format=I420,width=1600,height=900 ! jpegenc quality=60 ! fakesink")"
  fi
  case $nv_res in
    ✓*) summary "✓" "NVENC (nvh264enc)" "deneme kodlaması başarılı" ;;
    *)  summary "✗" "NVENC (nvh264enc)" "$nvenc_el / $nv_res" ;;
  esac
  if [ "$webrtc_el" != "YOK" ] && [ "$nice_el" != "YOK" ]; then
    summary "✓" "GStreamer webrtcbin + libnice" "$webrtc_el"
  else
    summary "✗" "GStreamer webrtcbin + libnice" "webrtcbin: $webrtc_el, nicesrc: $nice_el (yalnız WebRTC seçilirse gerekli)"
  fi

  # -------------------------------------------------------------- Python
  hdr "Python"
  local py_out=""
  if have python3; then
    py_out=$(python3 - <<'PY'
import importlib
import importlib.util

def ver(name):
    if importlib.util.find_spec(name) is None:
        return "YOK"
    try:
        mod = importlib.import_module(name)
    except Exception as e:  # noqa: BLE001
        return f"import hatası: {type(e).__name__}: {e}"
    return str(getattr(mod, "__version__", "kurulu"))

for name in ["gi", "dbus_next", "dbus_fast", "aiohttp", "websockets", "evdev", "aiortc", "av", "qrcode"]:
    print(f"  {name:<38} {ver(name)}")

try:
    import gi
    for ns in ["Gst", "GstApp", "GstVideo", "GstWebRTC", "GstSdp"]:
        try:
            gi.require_version(ns, "1.0")
            mod = importlib.import_module(f"gi.repository.{ns}")
            extra = ""
            if ns == "Gst":
                mod.init(None)
                extra = " " + mod.version_string()
            print(f"  gi {ns:<35} ✓{extra}")
        except Exception as e:  # noqa: BLE001
            print(f"  gi {ns:<35} YOK ({type(e).__name__})")
except Exception as e:  # noqa: BLE001
    print(f"  gi                                     YOK ({e})")
PY
)
    echo "$py_out"
  fi
  if grep -qE '^  gi Gst +✓' <<<"$py_out"; then
    summary "✓" "Python + GStreamer gi" "$(sed -n 's/^  gi Gst *✓ *//p' <<<"$py_out")"
  else
    summary "✗" "Python + GStreamer gi" "python3-gi / gir1.2-gstreamer-1.0 eksik"
  fi
  if grep -qE '^  gi GstApp +✓' <<<"$py_out" && grep -qE '^  gi GstVideo +✓' <<<"$py_out"; then
    summary "✓" "gi GstApp + GstVideo" "gir1.2-gst-plugins-base-1.0"
  else
    summary "✗" "gi GstApp + GstVideo" "gir1.2-gst-plugins-base-1.0 eksik"
  fi
  local dn
  dn=$(sed -n 's/^  dbus_next *//p' <<<"$py_out")
  summary "$([ -n "$dn" ] && [ "$dn" != "YOK" ] && echo ✓ || echo ✗)" "dbus-next" "${dn:-?}"
  local ah
  ah=$(sed -n 's/^  aiohttp *//p' <<<"$py_out")
  summary "$([ -n "$ah" ] && [ "$ah" != "YOK" ] && echo ✓ || echo ✗)" "aiohttp" "${ah:-?}"

  # -------------------------------------------------------------- input fallback
  hdr "Input fallback (uinput / ydotool / xkbcommon)"
  local uin="✗"
  if [ -e /dev/uinput ]; then
    kv "/dev/uinput" "$(ls -l /dev/uinput 2>/dev/null)"
    [ -w /dev/uinput ] && uin="✓"
  else
    kv "/dev/uinput" "YOK"
  fi
  kv "/dev/uinput bu kullanıcı yazabilir mi" "$uin"
  kv "gruplar" "$(id -nG)"
  kv "ydotool" "$(command -v ydotool || echo YOK)"
  local ydd
  ydd=$(pgrep -a ydotoold 2>/dev/null | head -1)
  kv "ydotoold çalışıyor mu" "${ydd:-hayır}"
  kv "libxkbcommon.so.0" "$(ldconfig -p 2>/dev/null | grep -m1 -o '/[^ ]*libxkbcommon.so.0$' || echo YOK)"

  # -------------------------------------------------------------- ağ
  hdr "Ağ / Tailscale (IP ve tailnet adını rapordan silebilirsin)"
  have ip && ip -brief -4 addr show 2>/dev/null | sed 's/^/  /'
  local ts_ip=""
  if have tailscale; then
    kv "tailscale" "$(tailscale version 2>/dev/null | head -1)"
    ts_ip=$(timeout 5 tailscale ip -4 2>/dev/null | head -1)
    kv "tailscale ip -4" "${ts_ip:-(yok / oturum açılmamış)}"
    kv "MagicDNS adı" "$(timeout 5 tailscale status --json 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Self",{}).get("DNSName","-"))' 2>/dev/null)"
    echo "  tailscale serve status:"
    timeout 5 tailscale serve status 2>&1 | sed 's/^/    /' | head -10
    summary "$([ -n "$ts_ip" ] && echo ✓ || echo ✗)" "Tailscale" "${ts_ip:-kurulu ama bağlı değil}"
  else
    kv "tailscale" "YOK"
    summary "✗" "Tailscale" "kurulu değil (Aşama 5'te gerekli)"
  fi
  summary "$uin" "/dev/uinput yazılabilir" "yalnız uinput fallback için gerekli"

  # -------------------------------------------------------------- özet
  hdr "ÖZET"
  local i
  for i in "${!SUM_K[@]}"; do
    printf '  [%s] %s %s\n' "${SUM_S[$i]}" "$(pad "${SUM_K[$i]}" 36)" "${SUM_D[$i]}"
  done

  echo
  echo "  Önerilen capture+input backend'i:"
  if [ -n "$m_rd" ] && [ -n "$m_sc" ]; then
    echo "    → MUTTER doğrudan API: kurulum ve izin diyaloğu gerektirmez, monitörü connector adıyla seçer."
  elif [ "$rd_persist" = "✓" ]; then
    echo "    → PORTAL (RemoteDesktop+ScreenCast, persist_mode=2). İzin diyaloğu yalnız ilk seferde."
  else
    echo "    → Portal (diyaloglu) + uinput fallback. Ayrıntı için raporu paylaş."
  fi
  if [ "$os_id" = "pop" ] && [ "$os_ver" = "22.04" ]; then
    echo "  Not: Pop!_OS 22.04 = GNOME 42 / xdg-desktop-portal-gnome 42; RemoteDesktop oturum geri yükleme 45'te geldi."
  fi
  if [ "$xdp_ver" != "YOK" ]; then
    echo "  xdg-desktop-portal ${xdp_ver}, xdg-desktop-portal-gnome ${xdpg_ver}"
  fi
}

if [ "$(id -u)" -eq 0 ]; then
  echo "root olarak çalıştırma: oturum D-Bus'ına (kullanıcı oturumu) erişmem gerekiyor." >&2
  exit 1
fi
if ! have busctl; then
  echo "busctl bulunamadı (systemd). Rapor eksik olacak." >&2
fi

main 2>&1 | tee "$OUT"
echo
echo "Rapor kaydedildi: $OUT  — içeriğini bana yapıştırman yeterli."
