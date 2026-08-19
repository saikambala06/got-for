/**
 * SKVK motion runtime — shared by the web dashboard and the browser extension.
 *
 * Everything here degrades safely: if IntersectionObserver is missing, or the
 * user has asked for reduced motion, elements are shown immediately in their
 * final state instead of being left invisible.
 *
 * Keep this file in sync with browser-extension/motion.js.
 */

(function (global) {
  'use strict';

  const reduced = () =>
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Reveal on scroll ───────────────────────────────────────────────────

  let observer = null;

  function ensureObserver() {
    if (observer || !global.IntersectionObserver) return observer;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );
    return observer;
  }

  /**
   * Wire up every [data-reveal] inside `root`, assigning stagger indices to
   * the children of each [data-stagger] container.
   */
  function reveal(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-stagger]').forEach((group) => {
      const step = Number(group.dataset.stagger) || 1;
      Array.from(group.children).forEach((child, i) => {
        if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', '');
        child.style.setProperty('--i', String(i * step));
      });
    });

    const targets = scope.querySelectorAll('[data-reveal]:not(.is-in)');
    const io = ensureObserver();

    targets.forEach((el) => {
      if (reduced() || !io) { el.classList.add('is-in'); return; }
      io.observe(el);
    });

    scheduleSafetyNet();
  }

  // Safety net: [data-reveal] starts at opacity 0, so a missed observer
  // callback would leave real content permanently invisible. Anything that is
  // laid out and on screen but still un-revealed after a moment gets shown
  // unconditionally. Content being visible always beats content animating.
  let safetyTimer = null;

  function scheduleSafetyNet() {
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => {
      document.querySelectorAll('[data-reveal]:not(.is-in)').forEach((el) => {
        const rect = el.getBoundingClientRect();
        const rendered = rect.width > 0 || rect.height > 0;
        const onScreen = rect.top < (global.innerHeight || 0) && rect.bottom > 0;
        if (rendered && onScreen) el.classList.add('is-in');
      });
    }, 2500);
  }

  /** Reveal immediately, without waiting for scroll (for freshly injected UI). */
  function revealNow(root, { stagger = 45 } = {}) {
    const scope = root || document;
    const targets = Array.from(scope.querySelectorAll('[data-reveal]:not(.is-in)'));
    targets.forEach((el, i) => {
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(i));
      if (reduced()) { el.classList.add('is-in'); return; }
      setTimeout(() => el.classList.add('is-in'), i * (stagger / 8));
    });
  }

  // ── Auto-animate dynamic lists ─────────────────────────────────────────
  //
  // Most lists in this app (job rows, saved resumes, recent activity, summary
  // cards) are rendered by JavaScript long after DOMContentLoaded, so the
  // scroll-reveal observer never sees them. Marking their container with
  // [data-animate-children] makes every element inserted into it fade up on a
  // stagger, without each render function having to know about motion at all.

  const listObservers = new WeakMap();

  function animateChildren(container) {
    if (!container || listObservers.has(container) || !global.MutationObserver) return;

    const apply = (nodes) => {
      if (reduced()) return;
      let i = 0;
      for (const node of nodes) {
        if (node.nodeType !== 1) continue;
        node.style.setProperty('--i', String(i));
        node.style.animation = `sk-fade-up .42s var(--ease-out) both`;
        node.style.animationDelay = `${i * 40}ms`;
        i++;
        // Long lists shouldn't end with a visible wait on the last row.
        if (i > 14) break;
      }
    };

    const mo = new MutationObserver((records) => {
      const added = [];
      for (const rec of records) added.push(...rec.addedNodes);
      if (added.length) apply(added);
    });
    mo.observe(container, { childList: true });
    listObservers.set(container, mo);

    // Anything already rendered before we attached still gets the treatment.
    if (container.children.length) apply(Array.from(container.children));
  }

  function wireAutoAnimate(root) {
    (root || document).querySelectorAll('[data-animate-children]').forEach(animateChildren);
  }

  // ── Number count-up ────────────────────────────────────────────────────

  /**
   * Animate an element's text from 0 to `to`, easing out so it decelerates
   * into the final value rather than ticking linearly.
   */
  function countUp(el, to, { duration = 900, decimals = 0, suffix = '', prefix = '' } = {}) {
    if (!el) return;
    const target = Number(to) || 0;
    const render = (v) => { el.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`; };

    if (reduced()) { render(target); return; }

    const start = performance.now();
    const from = 0;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      render(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ── Progress ring ──────────────────────────────────────────────────────

  /**
   * Drive an SVG circle as a progress ring. `percent` is 0-100.
   * Returns the circumference so callers can reuse it.
   */
  function setRing(circle, percent, { radius } = {}) {
    if (!circle) return 0;
    const r = radius || Number(circle.getAttribute('r')) || 52;
    const circumference = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));

    circle.style.strokeDasharray = String(circumference);
    // Start empty so the transition has somewhere to travel from.
    circle.style.strokeDashoffset = String(circumference);

    const apply = () => { circle.style.strokeDashoffset = String(circumference * (1 - clamped / 100)); };
    if (reduced()) apply();
    else requestAnimationFrame(() => requestAnimationFrame(apply));

    return circumference;
  }

  // ── Meters ─────────────────────────────────────────────────────────────

  /** Fill every .meter-fill inside `root` from its data-value (0-100). */
  function fillMeters(root) {
    const scope = root || document;
    scope.querySelectorAll('.meter-fill').forEach((el, i) => {
      const value = Math.max(0, Math.min(100, Number(el.dataset.value) || 0));
      el.style.setProperty('--i', String(i));
      el.style.setProperty('--fill', String(value / 100));
      el.classList.toggle('low', value < 40);
      el.classList.toggle('mid', value >= 40 && value < 75);
      const apply = () => { el.style.transform = `scaleX(${value / 100})`; };
      if (reduced()) apply();
      else requestAnimationFrame(() => requestAnimationFrame(apply));
    });
  }

  // ── Sliding tab pill ───────────────────────────────────────────────────

  /**
   * Move the single highlight pill under the active tab. Using one moving
   * element (rather than styling each tab) is what makes the switch read as
   * continuous motion.
   */
  function moveTabPill(container) {
    if (!container) return;
    const pill = container.querySelector('.tab-pill');
    const active = container.querySelector('.tab.active');
    if (!pill || !active) return;
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  // ── Toast ──────────────────────────────────────────────────────────────

  let toastTimer = null;

  function toast(message, type = 'success', ms = 3200) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    clearTimeout(toastTimer);

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.textContent = String(message || '');
    document.body.appendChild(el);

    toastTimer = setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    }, ms);
    return el;
  }

  // ── Ripple ─────────────────────────────────────────────────────────────

  /** Attach a click ripple to every .btn, anchored where the pointer landed. */
  function wireRipples(root) {
    (root || document).querySelectorAll('.btn:not([data-ripple])').forEach((btn) => {
      btn.setAttribute('data-ripple', '');
      btn.addEventListener('click', (e) => {
        if (reduced()) return;
        const rect = btn.getBoundingClientRect();
        const dot = document.createElement('span');
        const size = Math.max(rect.width, rect.height) * 1.6;
        Object.assign(dot.style, {
          position: 'absolute',
          left: `${e.clientX - rect.left - size / 2}px`,
          top: `${e.clientY - rect.top - size / 2}px`,
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.35)',
          transform: 'scale(0)',
          opacity: '1',
          pointerEvents: 'none',
          transition: 'transform .55s cubic-bezier(.16,1,.3,1), opacity .55s ease'
        });
        btn.appendChild(dot);
        requestAnimationFrame(() => { dot.style.transform = 'scale(1)'; dot.style.opacity = '0'; });
        setTimeout(() => dot.remove(), 600);
      });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────

  function init(root) {
    reveal(root);
    wireRipples(root);
    fillMeters(root);
    wireAutoAnimate(root);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init());
    } else {
      init();
    }
    global.addEventListener('resize', () => {
      document.querySelectorAll('.tabs').forEach(moveTabPill);
    });
  }

  global.motion = {
    reveal, revealNow, countUp, setRing, fillMeters,
    moveTabPill, toast, wireRipples, animateChildren, wireAutoAnimate,
    init, reduced
  };
})(typeof window !== 'undefined' ? window : this);
