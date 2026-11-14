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
  // Appends one boxed group per { title, params } to `container`: numeric
  // definitions become knobs, `options` become drop-downs.
  // o: { values, defaults?, onInput(key, v), onChange?(key, v) }
  // Returns { set(key, v), sync(values) }.
  function buildKnobGroups(container, groups, o) {
    const controls = {};
    const defaults = o.defaults || {};
    for (const g of groups) {
      const box = el('div', 'group');
      const body = el('div', 'group-body');
      box.append(el('div', 'group-title', g.title), body);
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

  N.ui = { makeKnob, buildKnobGroups, buildParamPanel, collapsible };
})(typeof self !== 'undefined' ? self : this);
