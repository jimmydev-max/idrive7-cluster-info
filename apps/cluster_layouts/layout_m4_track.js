'use strict';
/**
 * layout_m4_track.js - "M4 Track": a G8x M-style cluster, built from custom cluster shaders (shaders.js:
 * RPMBAR_FS, GFORCE_FS, VBAR_FS) so it matches the design.
 *
 *  - a thick white rev bar across the top with per-thousand numbers, an amber caution zone, a red zone and a
 *    bright leading line; the fill follows the current zone's colour and flashes in the caution/red zones;
 *  - a g-force meter on the left (dashed 1 g / 1.5 g rings, a live dot from the car's lateral/longitudinal g);
 *  - a horizontal boost bar and a virtual HP / TQ dyno;
 *  - a big centre gear with the engine speed, the speed below it;
 *  - coolant and oil as vertical bars on the right (210 mid tick, 165 and 255 ticks, the hot one red);
 *  - a fuel bar and the odometer along the bottom.
 *  Centre = map puts the Waze / stock map in the middle with the gauges wrapped around it.
 *
 * Every reading is kept clear of the camera cowl, the KOMBI's gear box and eDrive box, the warning-light strip
 * and the slanted corners (layout_common; tools/clearance.js checks it), and the whole thing stays under the
 * render service's 60-layer budget. The custom shaders are new to the KOMBI's GPU: build it and check it PARKED
 * before driving (the stock cluster returns on its own if anything is off).
 */
const C = require('./layout_common');

const PALETTES = {
    comfort: { accent: '#e8b320', glow: '#f2922a', mode: 'COMFORT' },
    sport: { accent: '#e5402b', glow: '#e5402b', mode: 'SPORT' },
    efficient: { accent: '#35e08a', glow: '#35e08a', mode: 'EFFICIENT' },
};
const BASE = {
    bg: '#000000', text: '#f4f4f4', dim: '#8d9196', track: '#15181c', edge: '#2a2f36',
    red: '#e5402b', amber: '#e8b320', white: '#c4c5bf', cream: '#e6dac6', ev: '#7fcbe8',
    num: '#f4f4f4', lead: '#ffffff', ring: '#3a4149', ring2: '#2f363d', cross: '#20252a', orange: '#f2922a', tip: '#f4f4f4',
};
const pal = (lookId) => Object.assign({}, BASE, PALETTES[lookId] || PALETTES.comfort);

const white = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.1] });
const lbl = (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] });
const acc = (t) => ({ color: [t.accent, 1], glow: [t.glow, 0.3] });
const orange = (t) => ({ color: [t.orange, 1], glow: [t.glow, 0.25] });
const cream = (t) => ({ color: [t.cream, 1], glow: [t.glow, 0] });

/* ---------- live estimates ---------- */
const hpVal = (d) => (C.isNum(d.torque) && C.isNum(d.rpm) && d.torque > 0 ? d.torque * d.rpm / 9549 / 0.7457 : 0);
const hpText = (d) => (C.isNum(d.torque) && C.isNum(d.rpm) && d.torque > 0 ? String(Math.round(hpVal(d))) : '--');
const tqText = (d) => (C.isNum(d.torque) && d.torque > 0 ? String(Math.round(d.torque)) : '--');
const boostNum = (o) => (d) => (d.engineOn === false ? 'OFF' : !C.isNum(d.boostActual) ? '--'
    : o.speedUnit === 'kmh' ? d.boostActual.toFixed(2) : (d.boostActual * 14.5038).toFixed(1));
const rpmText = (d) => (C.isNum(d.rpm) && d.engineOn !== false ? String(Math.round(d.rpm / 50) * 50) : 'OFF');
const gearC = (t, d) => ({ color: [C.gearText(d) === 'R' ? t.red : t.orange, 1], glow: [t.glow, 0.25] });
/* a temperature (deg C) on the 120-300 deg F scale, 0..1 */
const tempFracF = (c) => (C.isNum(c) ? Math.max(0, Math.min(1, (c * 9 / 5 + 32 - 120) / 180)) : 0);

/* ---------- custom pieces ---------- */
function revBar(o, x, y, w, h) {
    const r = C.rpmScale(o), caution = Math.max(0, (r.red - 1) / r.max), redf = r.red / r.max;
    const flashFrom = (r.red - 1) * 1000;   /* amber (and the flash) 1000 rpm before the red line: 6k for a 7k red line */
    return {
        key: 'revBar', kind: 'rpmbar', x, y, w, h,
        params: { u_caution: [caution], u_red: [redf], u_round: [10] },
        colors: (t) => ({ track: t.track, fill: t.white, amber: t.amber, redc: t.red, lead: t.lead }),
        value: (d) => (C.isNum(d.rpm) ? d.rpm / 1000 / r.max : 0), max: 1, sweep: true,
        dyn: (d) => ({ u_flash: [C.isNum(d.rpm) && d.rpm >= flashFrom ? 1 : 0] }),
    };
}
function revScale(o, x, y, w, h) {
    const r = C.rpmScale(o), caution = Math.max(0, (r.red - 1) / r.max), redf = r.red / r.max;
    const flashFrom = (r.red - 1) * 1000;
    return {
        key: 'revScale', kind: 'rpmscale', x, y, w, h,
        params: { u_max: [r.max], u_caution: [caution], u_red: [redf], u_round: [8], u_pad: [70] },
        colors: (t) => ({ track: t.dim, fill: t.white, amber: t.amber, redc: t.red }),
        value: (d) => (C.isNum(d.rpm) ? d.rpm / 1000 / r.max : 0), max: 1, sweep: true,
        dyn: (d) => ({ u_flash: [C.isNum(d.rpm) && d.rpm >= flashFrom ? 1 : 0] }),
    };
}
function revNumbers(o, x0, y, step, h) {
    const r = C.rpmScale(o), out = [];
    for (let i = 0; i <= r.max; i++) {
        const red = i >= r.red, amber = !red && i >= r.red - 1;
        out.push(C.text('rN' + i, x0 + i * step - 24, y, 48, h, String(i),
            (t) => ({ color: [red ? t.red : amber ? t.amber : t.text, 1], glow: [t.glow, red ? 0.25 : 0] })));
    }
    return out;
}
function gforce(x, y, s) {
    const cx = x + s / 2;
    return [
        { key: 'gforce', kind: 'gforce', x, y, w: s, h: s, colors: (t) => ({ ring: t.ring, ring2: t.ring2, cross: t.cross, dot: t.orange }),
            dyn: (d) => ({ u_g: [C.isNum(d.gLat) ? Math.max(-1.1, Math.min(1.1, d.gLat / 1.5)) : 0, C.isNum(d.gLong) ? Math.max(-1.1, Math.min(1.1, -d.gLong / 1.5)) : 0] }) },
        C.text('gLbl', cx - 90, y - 26, 180, 22, 'G-FORCE', lbl, { tracking: 0.2 }),
        C.text('g15', cx - 60, y + s * 0.5 - s * 0.5 + 6, 120, 24, '1.5 g', (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] })),
        C.text('g10', cx - 50, y + s * 0.22 + 6, 100, 20, '1 g', (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] })),
    ];
}
function vTemp(key, x, y, w, h, valueC, label) {
    return [
        C.text(key + 'R', x - 20, y - 28, w + 40, 26, (d) => C.tempText({ tempUnit: 'f' }, valueC(d)), white),
        { key, kind: 'vbar', x, y, w, h, params: { u_marks: [0.25, 0.5, 0.75, 0], u_redmark: [4] },
            colors: (t) => ({ track: t.track, fill: t.cream, tick: t.dim, redc: t.red }),
            value: (d) => tempFracF(valueC(d)), max: 1 },
        C.text(key + 'L', x - 40, y + h + 10, w + 80, 18, label, lbl, { tracking: 0.08 }),
    ];
}
const barColors = (t) => ({ track: t.track, fill0: t.accent, fill1: t.accent, redc: t.red, tip: t.text, tick: t.dim, num: t.num });
function hBar(key, x, y, w, label, valueText, frac, marks, unit, extraCol) {
    const out = [
        C.text(key + 'L', x, y, 140, 20, label, lbl, { align: 0, tracking: 0.12 }),
        C.text(key + 'V', x + w - 140, y, 140, 22, valueText, extraCol || white, { align: 1 }),
        C.bar(key, x, y + 26, w, 18, frac, barColors, 0),
    ];
    marks.forEach((m, i) => out.push(C.text(key + 'm' + i, x + m.f * w - 30, y + 50, 60, 18, m.t, lbl)));
    return out;
}

module.exports = {
    id: 'm4_track',
    title: 'M4 Track',
    palette: pal,
    gearText: C.gearText,

    pieces(o) {
        const r = C.rpmScale(o);
        const fuel = () => [
            { key: 'fuelIcon', kind: 'icon', x: 60, y: 664, w: 30, h: 30, params: { u_icon: [4], u_line: [2.5] }, colors: (t) => ({ color: [t.cream, 1] }) },
            C.bar('fuel', 100, 670, 190, 14, (d) => (C.isNum(d.fuelPct) ? d.fuelPct / 100 : 0),
                (t) => ({ track: t.track, fill0: t.cream, fill1: t.cream, redc: t.red, tip: t.cream, tick: t.dim, num: t.num }), 0),
            C.text('frange', 300, 664, 220, 24, (d) => C.distText(o, d.frange) + ' left', cream, { align: 0 }),
        ];
        const odo = C.text('odo', 1540, 662, 372, 28, (d) => (C.isNum(d.odo) ? Math.round(d.odo).toLocaleString() + (o.speedUnit === 'kmh' ? ' km' : ' mi') : ''), lbl, { align: 1 });

        if (o.centre === 'map') {
            // the rev bar as a header across the top of the map (same design as the non-map view), the speed and
            // gear large on the left, coolant and oil on the right
            return C.aroundMap().map((rr, i) => C.flat('bg' + i, rr.x, rr.y, rr.w, rr.h, 'bg')).concat(
                [revBar(o, 416, 60, 1088, 48)],
                revNumbers(o, 470, 76, (1450 - 470) / r.max, 36),
                [
                    C.text('speedDigits', 90, 200, 320, 160, (d) => C.speedText(o, d), white, { align: 0 }),
                    C.text('speedUnit', 90, 362, 320, 30, C.speedUnit(o), lbl, { align: 0 }),
                    C.text('gear', 90, 398, 320, 220, C.gearText, gearC, { align: 0 }),
                    C.text('rpm', 90, 622, 320, 26, (d) => rpmText(d) + ' RPM', acc, { align: 0 }),
                ],
                vTemp('coolant', 1690, 322, 44, 226, (d) => d.coolant, 'COOLANT'),
                vTemp('oil', 1804, 322, 44, 226, (d) => d.oil, 'OIL'),
                [].concat(fuel(), [odo]),
            );
        }
        if (o.centre === 'stock') {
            return [C.flat('bg', 0, 0, 566, 720, 'bg'), C.flat('bgR', 1104, 0, 816, 720, 'bg')].concat(
                [revBar(o, 120, 196, 420, 30)],
                revNumbers(o, 146, 198, (420 - 52) / r.max, 28),
                gforce(150, 300, 200),
                (o.cluster === 'm' ? [
                    // M car: drop the gear/speed into the clear band below the KOMBI's two boxes
                    C.text('gearS', 1140, 430, 260, 120, C.gearText, gearC),
                    C.text('speedS', 1140, 552, 260, 74, (d) => C.speedText(o, d), white),
                    C.text('speedUS', 1140, 628, 260, 22, C.speedUnit(o), lbl),
                ] : [
                    C.text('gearS', 1140, 250, 260, 160, C.gearText, gearC),
                    C.text('speedS', 1140, 430, 260, 90, (d) => C.speedText(o, d), white),
                    C.text('speedUS', 1140, 524, 260, 24, C.speedUnit(o), lbl),
                ]),
                vTemp('coolant', 1690, 302, 44, 226, (d) => d.coolant, 'COOLANT'),
                vTemp('oil', 1804, 302, 44, 226, (d) => d.oil, 'OIL'),
                [].concat(fuel(), [odo]),
            );
        }

        // performance view (info)
        return [C.flat('bg', 0, 0, 1920, 720, 'bg'),
            C.text('rpmLbl', 280, 66, 1360, 26, 'RPM x1000', lbl, { tracking: 0.14 }),
            revScale(o, 280, 110, 1360, 144)].concat(
            // numbers aligned to the scale: left edge 280 + 70 pad, span (1360 - 2*70) across r.max
            revNumbers(o, 280 + 70, 152, (1360 - 140) / r.max, 60),
            gforce(120, 300, 220),
            hBar('boost', 400, 380, 320, 'BOOST PSI', boostNum(o), (d) => (C.isNum(d.boostActual) ? Math.max(0, Math.min(1, d.boostActual * 14.5038 / 40)) : 0),
                [{ f: 0, t: '0' }, { f: 0.25, t: '10' }, { f: 0.5, t: '20' }, { f: 0.75, t: '30' }, { f: 1, t: '40' }], 'psi'),
            // On an M car the KOMBI's two dark boxes sit over the centre (layout_common M_BOXES), so the gear and
            // speed drop below them; otherwise they fill the centre as before.
            (o.cluster === 'm' ? [
                C.text('gear', 782, 430, 356, 212, C.gearText, gearC),
                C.text('speedDigits', 1140, 430, 268, 158, (d) => C.speedText(o, d), white),
                C.text('speedUnit', 1140, 590, 268, 56, C.speedUnit(o), lbl, { tracking: 0.12 }),
            ] : [
                C.text('gear', 720, 258, 480, 230, C.gearText, gearC),
                C.text('gearA', 1072, 300, 120, 66, (d) => ((d.mode === 'S' || d.mode === 'M') ? d.mode : /^(D|\d)/.test(C.gearText(d) || '') ? 'A' : ''), orange),
                C.text('speedDigits', 720, 500, 480, 110, (d) => C.speedText(o, d), white),
                C.text('speedUnit', 720, 612, 480, 26, C.speedUnit(o), lbl, { tracking: 0.12 }),
            ]),
            vTemp('coolant', 1690, 302, 44, 226, (d) => d.coolant, 'COOLANT'),
            vTemp('oil', 1804, 302, 44, 226, (d) => d.oil, 'OIL'),
            [].concat(fuel(), [odo]),
        );
    },
};
