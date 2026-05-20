# Latitude — Design System

Matches the look of textbook.darvinyi.com: dark base, single teal-cyan accent, editorial serif headings, sans body, mono labels.

## Color tokens

```css
:root {
  /* Surfaces */
  --bg:           #0d0d0d;
  --bg-elev:      #141414;
  --surface:      #181818;
  --surface-2:    #1f1f1f;
  --border:       #2a2a2a;
  --border-soft:  #222;
  --border-bright:#3a3a3a;

  /* Text */
  --text:         #e8e6e1;
  --text-soft:    #a0a0a0;
  --text-faint:   #6a6a6a;
  --text-dim:     #4a4a4a;

  /* Single accent — teal/cyan */
  --accent:       #2dd4bf;
  --accent-bright:#5eead4;
  --accent-dim:   rgba(45, 212, 191, 0.14);
  --accent-faint: rgba(45, 212, 191, 0.06);
  --accent-line:  rgba(45, 212, 191, 0.35);
}
```

No other color is used. No reds, no yellows, no purples, no gradients except subtle accent radial atmospheres.

## Typography

```css
:root {
  --serif: 'Crimson Pro', Georgia, serif;
  --sans:  'Inter', system-ui, sans-serif;
  --mono:  'JetBrains Mono', monospace;
}
```

| Use | Font | Notes |
|-----|------|-------|
| Display + headings | Crimson Pro | Weight 400 (regular), italic for emphasis |
| Body, UI text | Inter | Weight 300/400/500/600 |
| Labels, data, code, timing | JetBrains Mono | Weight 400/500, uppercase with `letter-spacing: 0.18em–0.22em` |

Emphasis: Italic Crimson Pro in `var(--accent)` color is the signature treatment. Use sparingly.

## Type scale

```
.display      → 68px / 1.0   / -0.02em   Crimson Pro 400
.display-sm   → 38px / 1.05  / -0.015em  Crimson Pro 400
.lede         → 22px / 1.45             Crimson Pro 300
.body         → 15px / 1.65             Inter 400
.label-mono   → 10.5px uppercase        JetBrains Mono 400 ls 0.2em
.kicker       → 11px uppercase accent   JetBrains Mono 400 ls 0.22em
```

## Layout

- App max-width: 1240px
- Page padding: `28px 48px 64px` desktop, `20px 22px 48px` mobile
- Grid gutters: 56px desktop, 28px mobile
- Section dividers: 1px solid `var(--border)`

## Components

### Button

Two variants. Primary is accent-on-dark; ghost is bordered.

```
.btn (primary)
  background:  var(--accent)
  color:       var(--bg)
  padding:     13px 22px
  font:        var(--mono) 11px / 500 / ls 0.2em / uppercase
  hover:       background var(--accent-bright); box-shadow 0 0 18px var(--accent-dim)

.btn.btn-ghost
  background:  transparent
  color:       var(--text)
  border:      1px solid var(--border-bright)
  hover:       border var(--accent); color var(--accent); background var(--surface)
```

### Chip

```
.chip
  background:  transparent
  color:       var(--text-soft)
  border:      1px solid var(--border-bright)
  padding:     8px 14px
  font:        var(--mono) 10.5px / ls 0.14em / uppercase
  
.chip.is-selected
  background:  var(--accent-faint)
  color:       var(--accent)
  border:      var(--accent)
  box-shadow:  inset 0 0 0 1px var(--accent-line)
```

### Input

Underlined inputs, not boxed.

```
.form-input
  background:  transparent
  border:      none
  border-bottom: 1px solid var(--border-bright)
  font:        var(--serif) 17px
  color:       var(--text)
  focus:       border var(--accent)
```

Labels above, mono uppercase:

```
.form-label
  font: var(--mono) 10px / ls 0.22em / uppercase
  color: var(--text-faint)
```

### Card

Used for past-walk tiles and form containers.

```
background:  var(--surface)
border:      1px solid var(--border)
hover:       border var(--accent-line); transform translateY(-2px); box-shadow 0 4px 18px rgba(0,0,0,0.4)
```

## Brand mark

```
Latitude.
^  ^      ^
|  |      └─ glowing teal dot, 6px, box-shadow 0 0 12px var(--accent)
|  └────── normal Crimson Pro
└────────── italic + teal "L"
```

```html
<span class="brand-mark">L</span>atitude<span class="brand-dot"></span>
```

## Animations

- Page transitions: `fade-in 0.3s ease`
- Accent dot pulse (agent active): `pulse 2s ease infinite` (0%/100% opacity 1, 50% opacity 0.4)
- Button hover: 0.18s
- No flashy animations beyond these.

## Reference

The HTML prototype at the project root (committed as `context/prototype-reference.html` if you have it) is the visual ground truth. Frontend components should match its look 1:1.
