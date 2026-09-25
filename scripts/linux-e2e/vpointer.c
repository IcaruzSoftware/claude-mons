// vpointer — a tiny persistent virtual-pointer client for the Linux e2e wayland leg.
//
// The headless wlroots (sway) session has no input devices (WLR_LIBINPUT_NO_DEVICES=1), so its seat
// advertises no pointer capability and sway never assigns the seat to XWayland — meaning `swaymsg
// seat cursor …` warps a cursor XWayland cannot see and no X client ever gets input. Creating a
// zwlr_virtual_pointer_v1 attaches a real pointer device to the seat: the seat gains pointer
// capability, sway assigns it to XWayland, and events flow compositor -> XWayland -> app exactly as
// on a real Wayland session.
//
// The client stays alive (so the capability persists) and reads one command per line from stdin:
//   move <x> <y>     absolute motion to layout coords (extent = the 1920x1080 output)
//   down <left|right>
//   up   <left|right>
//   click <left|right>
//   quit
// stdin is wired to a FIFO opened read-write by run.sh, so reads block for the next command and never
// hit EOF between the probe's writes. See scripts/linux-e2e/run.sh and docs/runbooks/linux-e2e.md.

#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <wayland-client.h>
#include <linux/input-event-codes.h>
#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"

static struct zwlr_virtual_pointer_manager_v1 *mgr = NULL;
static struct wl_seat *seat = NULL;
static const uint32_t EXT_X = 1920, EXT_Y = 1080;

static uint32_t now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint32_t)(t.tv_sec * 1000 + t.tv_nsec / 1000000);
}

static void reg_global(void *data, struct wl_registry *reg, uint32_t name,
                       const char *iface, uint32_t ver) {
  (void)data;
  if (strcmp(iface, zwlr_virtual_pointer_manager_v1_interface.name) == 0)
    mgr = wl_registry_bind(reg, name, &zwlr_virtual_pointer_manager_v1_interface, ver < 2 ? ver : 2);
  else if (strcmp(iface, wl_seat_interface.name) == 0)
    seat = wl_registry_bind(reg, name, &wl_seat_interface, ver < 1 ? ver : 1);
}
static void reg_remove(void *data, struct wl_registry *reg, uint32_t name) {
  (void)data; (void)reg; (void)name;
}
static const struct wl_registry_listener reg_listener = { reg_global, reg_remove };

static uint32_t btn_code(const char *s) { return (s && s[0] == 'r') ? BTN_RIGHT : BTN_LEFT; }

int main(void) {
  struct wl_display *dpy = wl_display_connect(NULL);
  if (!dpy) { fprintf(stderr, "vpointer: cannot connect to wayland\n"); return 1; }
  struct wl_registry *reg = wl_display_get_registry(dpy);
  wl_registry_add_listener(reg, &reg_listener, NULL);
  wl_display_roundtrip(dpy);
  if (!mgr) { fprintf(stderr, "vpointer: compositor lacks zwlr_virtual_pointer_manager_v1\n"); return 1; }

  struct zwlr_virtual_pointer_v1 *vp =
      zwlr_virtual_pointer_manager_v1_create_virtual_pointer(mgr, seat);
  if (!vp) { fprintf(stderr, "vpointer: create_virtual_pointer failed\n"); return 1; }
  wl_display_roundtrip(dpy);
  fprintf(stderr, "vpointer: ready (seat=%s)\n", seat ? "bound" : "default");
  fflush(stderr);

  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    char cmd[32] = {0}, arg[32] = {0};
    long x = 0, y = 0;
    if (sscanf(line, "%31s", cmd) != 1) continue;
    uint32_t t = now_ms();
    if (strcmp(cmd, "move") == 0 && sscanf(line, "%*s %ld %ld", &x, &y) == 2) {
      if (x < 0) x = 0; if (y < 0) y = 0;
      if (x >= (long)EXT_X) x = EXT_X - 1; if (y >= (long)EXT_Y) y = EXT_Y - 1;
      zwlr_virtual_pointer_v1_motion_absolute(vp, t, (uint32_t)x, (uint32_t)y, EXT_X, EXT_Y);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (strcmp(cmd, "down") == 0 && sscanf(line, "%*s %31s", arg) == 1) {
      zwlr_virtual_pointer_v1_button(vp, t, btn_code(arg), WL_POINTER_BUTTON_STATE_PRESSED);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (strcmp(cmd, "up") == 0 && sscanf(line, "%*s %31s", arg) == 1) {
      zwlr_virtual_pointer_v1_button(vp, t, btn_code(arg), WL_POINTER_BUTTON_STATE_RELEASED);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (strcmp(cmd, "click") == 0 && sscanf(line, "%*s %31s", arg) == 1) {
      uint32_t c = btn_code(arg);
      zwlr_virtual_pointer_v1_button(vp, t, c, WL_POINTER_BUTTON_STATE_PRESSED);
      zwlr_virtual_pointer_v1_frame(vp);
      zwlr_virtual_pointer_v1_button(vp, now_ms(), c, WL_POINTER_BUTTON_STATE_RELEASED);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (strcmp(cmd, "quit") == 0) {
      break;
    }
    wl_display_flush(dpy);
  }

  zwlr_virtual_pointer_v1_destroy(vp);
  wl_display_flush(dpy);
  wl_display_disconnect(dpy);
  return 0;
}
