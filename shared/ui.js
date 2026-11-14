// nmlq shared UI: knobs, knob groups, slider panels and collapsible panels.
// Requires shared/core.js; styles live in shared/nmlq.css. Adds `nmlq.ui`.
(function (root) {
  'use strict';

  const N = root.nmlq;
  if (!N) throw new Error('shared/core.js must be loaded before shared/ui.js');

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- knob ----------
  // o: { label, min, max, step?, log?, value, def (double-click reset),
  //      format(v)?, onInput(v) (every change), onChange(v) (gesture end) }
  // Drag up / down (Shift for fine), scroll, or use the arrow keys.
  // Returns { el, set(v) } — set() updates the display without callbacks.
  function makeKnob(o) {
    const knob = el('div', 'knob');
    knob.tabIndex = 0;
    knob.setAttribute('role', 'slider');
    knob.setAttribute('aria-label', o.label);
    knob.setAttribute('aria-valuemin', o.min);
    knob.setAttribute('aria-valuemax', o.max);
    knob.title = o.label + ' — drag, scroll or use arrow keys; double-click to reset';
    knob.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="track"/><path class="fill"/><line class="pointer"/></svg>' +
      '<div class="k-value"></div><div class="k-label"></div>';
    const [track, fill, pointer] = knob.querySelectorAll('path, line');
    const valueEl = knob.querySelector('.k-value');
    knob.querySelector('.k-label').textContent = o.label;
    track.setAttribute('d', N.arcPath(-135, 135));

    const { toNorm, fromNorm } = N.knobScale(o);
    let value = o.value;
    const changed = () => { if (o.onChange) o.onChange(value); };

    function render() {
      const n = N.clamp(toNorm(value), 0, 1);
      const a = -135 + 270 * n;
      // Bipolar knobs (like pan) fill from the centre.
      const from = o.min < 0 && o.max > 0 ? 0 : -135;
      if (Math.abs(a - from) < 0.5) fill.removeAttribute('d');
      else fill.setAttribute('d', a > from ? N.arcPath(from, a) : N.arcPath(a, from));
      const rad = a * Math.PI / 180;
      pointer.setAttribute('x1', 20 + 6 * Math.sin(rad));
      pointer.setAttribute('y1', 20 - 6 * Math.cos(rad));
      pointer.setAttribute('x2', 20 + 13 * Math.sin(rad));
      pointer.setAttribute('y2', 20 - 13 * Math.cos(rad));
      const text = o.format ? o.format(value) : String(value);
      valueEl.textContent = text;
      knob.setAttribute('aria-valuenow', value);
      knob.setAttribute('aria-valuetext', text);
    }

    function set(v, fire) {
      v = N.clamp(v, o.min, o.max);
      if (v === value) return;
      value = v;
      render();
      if (fire && o.onInput) o.onInput(value);
    }

    let drag = null;
    knob.addEventListener('pointerdown', (ev) => {
      knob.setPointerCapture(ev.pointerId);
      knob.focus({ preventScroll: true });
      drag = { y: ev.clientY, n: toNorm(value) };
      ev.preventDefault();
    });
    knob.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const range = ev.shiftKey ? 800 : 200;
      set(fromNorm(drag.n + (drag.y - ev.clientY) / range), true);
    });
    const end = () => { if (drag) changed(); drag = null; };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    knob.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      set(fromNorm(toNorm(value) - Math.sign(ev.deltaY) * (ev.shiftKey ? 0.005 : 0.02)), true);
      changed();
    }, { passive: false });
    knob.addEventListener('keydown', (ev) => {
      const small = o.step && !o.log ? o.step / (o.max - o.min) : 0.01;
      const moves = { ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small, PageUp: 0.1, PageDown: -0.1 };
      let v;
      if (ev.key in moves) v = fromNorm(toNorm(value) + moves[ev.key]);
      else if (ev.key === 'Home') v = o.min;
      else if (ev.key === 'End') v = o.max;
      else return;
      ev.preventDefault();
      set(v, true);
      changed();
    });
    knob.addEventListener('dblclick', () => {
      if (o.def == null) return;
      set(o.def, true);
      changed();
    });

    render();
    return { el: knob, set: (v) => set(v, false) };
  }

  // ---------- knob groups ----------
  // Appends one boxed group per { title, params, toggle? } to `container`:
  // numeric definitions become knobs, `options` become drop-downs. A group
  // with `toggle: 'someKey'` gets an on/off checkbox in its title bound to
  // the boolean values[someKey] (the group dims when off).
  // o: { values, defaults?, onInput(key, v), onChange?(key, v) }
  // Returns { set(key, v), sync(values) }.
  function buildKnobGroups(container, groups, o) {
    const controls = {};
    const defaults = o.defaults || {};
    for (const g of groups) {
      const box = el('div', 'group');
      const body = el('div', 'group-body');
      const title = el('div', 'group-title');
      if (g.toggle) {
        const label = el('label', 'group-toggle');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.setAttribute('aria-label', g.title + ' on / off');
        const show = (v) => { cb.checked = !!v; box.classList.toggle('off', !v); };
        show(o.values[g.toggle]);
        cb.addEventListener('change', () => {
          show(cb.checked);
          o.onInput(g.toggle, cb.checked);
          if (o.onChange) o.onChange(g.toggle, cb.checked);
          cb.blur();
        });
        label.append(cb, document.createTextNode(g.title));
        title.appendChild(label);
        controls[g.toggle] = { set: show };
      } else {
        title.textContent = g.title;
      }
      box.append(title, body);
      for (const d of g.params) {
        const def = d.key in defaults ? defaults[d.key] : N.defaultValue(d);
        if (d.options) {
          const field = el('label', 'field');
          const sel = el('select');
          for (const [v, n] of d.options) sel.appendChild(new Option(n, v));
          sel.value = o.values[d.key];
          sel.addEventListener('change', () => {
            o.onInput(d.key, sel.value);
            if (o.onChange) o.onChange(d.key, sel.value);
            sel.blur(); // hand the keyboard back to the instrument
          });
          field.append(sel, el('span', null, d.label));
          body.appendChild(field);
          controls[d.key] = { set: (v) => { sel.value = v; } };
        } else {
          const knob = makeKnob(Object.assign({}, d, {
            value: o.values[d.key],
            def,
            onInput: (v) => o.onInput(d.key, v),
            onChange: o.onChange ? (v) => o.onChange(d.key, v) : null,
          }));
          body.appendChild(knob.el);
          controls[d.key] = knob;
        }
      }
      container.appendChild(box);
    }
    return {
      set: (key, v) => { if (controls[key]) controls[key].set(v); },
      sync: (values) => { for (const key in controls) if (key in values) controls[key].set(values[key]); },
    };
  }

  // ---------- slider panel ----------
  // Builds rows for flat definitions (see nmlq.loadDefaults): `{ section }`
  // starts a titled group, `bool` is a checkbox, `options` a drop-down, and
  // numbers a slider (with an on/off checkbox when the definition has
  // `toggle`). o: { defs, params, enabled, container(sectionDef) -> element,
  // onChange(key) }. Returns { sync() } to refresh after params change.
  function buildParamPanel(o) {
    const refs = {};
    let container = null;
    for (const def of o.defs) {
      if (def.section) {
        container = o.container(def);
        container.appendChild(el('div', 'section-title', def.section));
        continue;
      }
      const row = el('div', 'param-row');
      const head = el('div', 'param-head');
      const label = el('label');
      const text = el('span', 'param-label', def.label);
      const ref = { row };

      if ('bool' in def) {
        const cb = el('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => { o.params[def.key] = cb.checked; o.onChange(def.key); });
        label.append(cb, text);
        head.appendChild(label);
        row.appendChild(head);
        ref.checkbox = cb;
      } else if ('options' in def) {
        const sel = el('select');
        sel.setAttribute('aria-label', def.label);
        for (const [value, name] of def.options) sel.appendChild(new Option(name, value));
        sel.addEventListener('change', () => { o.params[def.key] = sel.value; o.onChange(def.key); });
        label.appendChild(text);
        head.append(label, sel);
        row.appendChild(head);
        ref.select = sel;
      } else {
        if ('toggle' in def) {
          const cb = el('input');
          cb.type = 'checkbox';
          cb.title = 'Enable / disable';
          cb.addEventListener('change', () => {
            o.enabled[def.key] = cb.checked;
            row.classList.toggle('disabled', !cb.checked);
            o.onChange(def.key);
          });
          label.appendChild(cb);
          ref.checkbox = cb;
        }
        label.appendChild(text);
        const valueEl = el('span', 'param-value');
        head.append(label, valueEl);
        const input = el('input');
        input.type = 'range';
        input.min = def.min;
        input.max = def.max;
        input.step = def.step;
        input.setAttribute('aria-label', def.label);
        input.addEventListener('input', () => {
          o.params[def.key] = parseFloat(input.value);
          valueEl.textContent = N.fmt.step(def, o.params[def.key]);
          o.onChange(def.key);
        });
        row.append(head, input);
        Object.assign(ref, { input, valueEl });
      }
      refs[def.key] = ref;
      container.appendChild(row);
    }

    function sync() {
      for (const def of o.defs) {
        if (!def.key) continue;
        const ref = refs[def.key];
        const v = o.params[def.key];
        if ('bool' in def) ref.checkbox.checked = v;
        else if ('options' in def) ref.select.value = v;
        else {
          ref.input.value = v;
          ref.valueEl.textContent = N.fmt.step(def, v);
          if (ref.checkbox) {
            ref.checkbox.checked = o.enabled[def.key];
            ref.row.classList.toggle('disabled', !o.enabled[def.key]);
          }
        }
      }
    }
    sync();
    return { sync };
  }

  // ---------- collapsible panel ----------
  // A Hide / Show button for a `.panel`. Returns setCollapsed(bool).
  function collapsible(button, panel, onChange) {
    function setCollapsed(collapsed) {
      panel.classList.toggle('collapsed', collapsed);
      button.textContent = collapsed ? 'Show' : 'Hide';
      button.setAttribute('aria-expanded', String(!collapsed));
      if (onChange) onChange(collapsed);
    }
    button.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
    return setCollapsed;
  }

  // ---------- strip (pitch bend / mod wheel) ----------
  // A vertical touch strip: `track` contains a `.thumb`. Value 0 (bottom) to
  // 1 (top); with `spring` it returns there on release.
  // o: { value, spring?, onInput(v) }
  function makeStrip(track, o) {
    const thumb = track.querySelector('.thumb');
    let value = o.value;
    const render = () => { thumb.style.top = ((1 - value) * 100) + '%'; };
    const fromEvent = (ev) => {
      const r = track.getBoundingClientRect();
      return N.clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
    };
    let active = null;
    track.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (track.setPointerCapture) { try { track.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ } }
      active = ev.pointerId;
      value = fromEvent(ev);
      render();
      o.onInput(value);
    });
    track.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== active) return;
      value = fromEvent(ev);
      render();
      o.onInput(value);
    });
    const end = (ev) => {
      if (ev.pointerId !== active) return;
      active = null;
      if (o.spring != null) { value = o.spring; render(); o.onInput(value); }
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    render();
    return { set: (v) => { value = v; render(); } };
  }

  // ---------- keyboard ----------
  // A playable piano keyboard: multi-touch (slide between keys), mouse, and
  // the computer keyboard (Z row = lowest octave on screen, Q row = the next,
  // ←/→ or ↓/↑ = octave, Space = sustain pedal, Esc = all off).
  // o: { keys (element), octave, span (octaves on screen), labels (bool),
  //      rangeEl?, sustainButton?, onNoteOn(n), onNoteOff(n),
  //      onOctave?(octave), onPanic?() }
  // Notes are MIDI numbers. A note held by several fingers / keys sounds
  // once; with sustain on, released notes keep sounding until it's lifted.
  function createKeyboard(o) {
    const keysEl = o.keys;
    const state = { octave: o.octave, span: o.span, labels: o.labels !== false };
    const phys = new Map();       // note -> number of fingers / keys holding it
    const sustained = new Set();  // released notes kept on by sustain
    const pointers = new Map();   // pointerId -> note (or null)
    const keysDown = new Map();   // event.code -> note
    let pedal = false, latch = false;
    let keyEls = [];
    const sustainOn = () => pedal || latch;
    const baseNote = () => 12 * (state.octave + 1);

    function build() {
      keysEl.textContent = '';
      keyEls = [];
      const count = state.span * 12 + 1;
      const w = 100 / (state.span * 7 + 1);
      let whites = 0;
      for (let i = 0; i < count; i++) {
        const black = N.BLACK_KEYS.includes(i % 12);
        const k = el('div', 'key ' + (black ? 'black' : 'white'));
        k.dataset.i = i;
        if (black) {
          k.style.left = (whites * w - w * 0.31) + '%';
          k.style.width = (w * 0.62) + '%';
        } else {
          whites++;
        }
        k.append(el('span', 'kl', N.KEY_LABELS[i] || ''), el('span', 'nn'));
        keysEl.appendChild(k);
        keyEls.push(k);
      }
      label();
    }

    function label() {
      const base = baseNote();
      keyEls.forEach((k, i) => {
        const name = N.noteName(base + i);
        k.querySelector('.nn').textContent = (base + i) % 12 === 0 ? name : '';
        k.setAttribute('aria-label', name);
      });
      if (o.rangeEl) o.rangeEl.textContent = 'C' + state.octave + '–C' + (state.octave + state.span);
      keysEl.classList.toggle('no-labels', !state.labels);
      paintAll();
    }

    function paint(n) {
      const k = keyEls[n - baseNote()];
      if (!k) return;
      k.classList.toggle('down', phys.has(n));
      k.classList.toggle('held', !phys.has(n) && sustained.has(n));
    }
    function paintAll() { keyEls.forEach((_, i) => paint(baseNote() + i)); }

    function noteDown(n) {
      if (n < 0 || n > 127) return;
      const c = phys.get(n) || 0;
      phys.set(n, c + 1);
      if (c === 0) {
        if (sustained.has(n)) { sustained.delete(n); o.onNoteOff(n); }
        o.onNoteOn(n);
      }
      paint(n);
    }

    function noteUp(n) {
      const c = phys.get(n) || 0;
      if (!c) return;
      if (c > 1) { phys.set(n, c - 1); return; }
      phys.delete(n);
      if (sustainOn()) sustained.add(n);
      else o.onNoteOff(n);
      paint(n);
    }

    function updateSustain() {
      if (!sustainOn() && sustained.size) {
        const list = Array.from(sustained);
        sustained.clear();
        for (const n of list) { o.onNoteOff(n); paint(n); }
      }
      if (o.sustainButton) o.sustainButton.setAttribute('aria-pressed', String(sustainOn()));
    }

    function setOctave(oct) {
      oct = N.clamp(oct, 0, N.maxOctave(state.span));
      if (oct === state.octave) return;
      state.octave = oct;
      label();
      if (o.onOctave) o.onOctave(oct);
    }

    function panic() {
      phys.clear();
      sustained.clear();
      pointers.clear();
      keysDown.clear();
      if (o.onPanic) o.onPanic();
      paintAll();
    }

    // pointer input
    function noteAtPoint(x, y) {
      const hit = document.elementFromPoint(x, y);
      const k = hit && hit.closest ? hit.closest('.key') : null;
      if (!k || !keysEl.contains(k)) return null;
      return baseNote() + parseInt(k.dataset.i, 10);
    }
    keysEl.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      ev.preventDefault();
      const n = noteAtPoint(ev.clientX, ev.clientY);
      pointers.set(ev.pointerId, n);
      if (n != null) noteDown(n);
    });
    root.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      const n = noteAtPoint(ev.clientX, ev.clientY);
      const prev = pointers.get(ev.pointerId);
      if (n === prev) return;
      if (prev != null) noteUp(prev);
      if (n != null) noteDown(n);
      pointers.set(ev.pointerId, n);
    });
    const endPointer = (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      const n = pointers.get(ev.pointerId);
      pointers.delete(ev.pointerId);
      if (n != null) noteUp(n);
    };
    root.addEventListener('pointerup', endPointer);
    root.addEventListener('pointercancel', endPointer);
    keysEl.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // computer keyboard
    root.addEventListener('keydown', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.defaultPrevented) return;
      if (N.isTypingTarget(ev.target)) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (!pedal) { pedal = true; updateSustain(); }
        return;
      }
      if (ev.key === 'Escape') { panic(); return; }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); if (!ev.repeat) setOctave(state.octave - 1); return; }
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!ev.repeat) setOctave(state.octave + 1); return; }
      if (!(ev.code in N.KEYMAP)) return;
      ev.preventDefault();
      if (ev.repeat || keysDown.has(ev.code)) return;
      const n = baseNote() + N.KEYMAP[ev.code];
      keysDown.set(ev.code, n);
      noteDown(n);
    });
    root.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') {
        if (!N.isTypingTarget(ev.target)) ev.preventDefault(); // keep Space from clicking a focused button
        if (pedal) { pedal = false; updateSustain(); }
      }
      if (!keysDown.has(ev.code)) return;
      noteUp(keysDown.get(ev.code));
      keysDown.delete(ev.code);
    });
    // Let go of everything if the window loses focus mid-press.
    root.addEventListener('blur', () => {
      for (const n of keysDown.values()) noteUp(n);
      keysDown.clear();
      for (const n of pointers.values()) if (n != null) noteUp(n);
      pointers.clear();
      if (pedal) { pedal = false; updateSustain(); }
    });

    if (o.sustainButton) o.sustainButton.addEventListener('click', () => { latch = !latch; updateSustain(); });

    build();
    return {
      setOctave,
      shiftOctave: (d) => setOctave(state.octave + d),
      setSpan(span) {
        state.span = span;
        const oct = N.clamp(state.octave, 0, N.maxOctave(span));
        const moved = oct !== state.octave;
        state.octave = oct;
        build();
        if (moved && o.onOctave) o.onOctave(oct);
      },
      setLabels(on) { state.labels = on; keysEl.classList.toggle('no-labels', !on); },
      panic,
      // Notes currently sounding from the keyboard (held or sustained).
      held: () => new Set([...phys.keys(), ...sustained]),
      get octave() { return state.octave; },
      get span() { return state.span; },
    };
  }

  // ---------- oscilloscope ----------
  // Draws an AnalyserNode's waveform into a canvas, steadied on a rising
  // zero crossing; a flat line when `active()` is false.
  // o: { analyser() -> AnalyserNode|null, active() -> bool, gain? }
  function createScope(canvas, o) {
    const ctx = canvas.getContext('2d');
    let color = '', data = null;
    const readColor = () => { color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); };
    readColor();
    if (root.matchMedia) {
      const mq = root.matchMedia('(prefers-color-scheme: light)');
      if (mq.addEventListener) mq.addEventListener('change', readColor);
    }
    function draw() {
      const dpr = root.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      const an = o.active() ? o.analyser() : null;
      if (!an) {
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      } else {
        if (!data || data.length !== an.fftSize) data = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(data);
        let start = 0;
        for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
        const n = Math.min(700, data.length - start);
        const g = o.gain || 1.6;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          const y = h / 2 - N.clamp(data[start + i] * g, -1, 1) * (h / 2 - 2 * dpr);
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
      }
      ctx.stroke();
    }
    return { draw };
  }

  N.ui = { makeKnob, buildKnobGroups, buildParamPanel, collapsible, makeStrip, createKeyboard, createScope };
})(typeof self !== 'undefined' ? self : this);
