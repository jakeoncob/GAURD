# Accessibility target: WCAG 2.2 AA

GAURD targets WCAG 2.2 Level AA. This document records implementation and verification, not a certification or a claim that every success criterion has been independently audited.

## Implemented behavior

| Area | Behavior and relevant criteria |
| --- | --- |
| Map alternatives | All 323 cities are available through keyboard-accessible search and a filterable city directory. The same large white comparison dialog opens from either interface; closing it returns focus to the city’s View crime comparison button. Map arrow buttons support single-pointer panning without dragging. Zoom and reset have dedicated buttons. Relevant: 1.1.1, 2.1.1, 2.5.7. |
| Charts | A screen-reader table provides series names, reporting years, rates, and unavailable states. The chart has a shared zero-based scale, values and labels, and striped forecast bars. Color does not carry meaning alone. Relevant: 1.1.1, 1.3.1, 1.4.1. |
| Crime categories | Native Violent / Property radio controls preserve keyboard focus when the comparison updates. The selected category, actual baseline/forecast years, and missing-data state are explicit. Relevant: 2.1.1, 3.2.2, 4.1.2, 4.1.3. |
| Contrast | Text uses dark blue on opaque white or pale blue surfaces. Primary text is 11.25:1 on white; secondary text is 5.57:1 on white and 5.05:1 on the soft blue surface. Chart fills are at least 3.02:1 against their plot background. Map marker outlines and overview boundaries meet 3:1 against their intended backgrounds. Relevant: 1.4.3, 1.4.11. |
| Reflow and text | Narrow screens and high browser zoom use a flowing panel over the fixed map. There is no fixed-height content sheet on mobile. Text can be enlarged independently, with wrapping controls and a footer that reserves its actual height. The two-dimensional map itself remains spatial. Relevant: 1.4.4, 1.4.10, 1.4.12. |
| Keyboard and focus | Skip links, modified Ctrl/Cmd+K search shortcut, arrow-key search and tab navigation, visible outlines, city-heading focus after selection, and focus restoration after closing dialogs/chat. Native dialogs contain focus. Phone and short-screen chat uses inert background content and a contained tab sequence. Desktop chat moves map controls out from underneath it. Relevant: 2.1.1, 2.1.2, 2.1.4, 2.4.1, 2.4.3, 2.4.7, 2.4.11. |
| Pointer targets | Main controls use at least 44px target height and at least 24px width; map-credit links have a 24px height. Inline text links use the applicable inline exception. Relevant: 2.5.8. |
| Motion and hover | No automatically looping mascot animation. The short greeting animation follows hover/focus. Reduced motion defaults to the device preference and can be saved in Display options. Map hints are dismissible with Escape and hoverable without following the cursor. Relevant: 1.4.13, 2.2.2; reduced motion also supports needs beyond AA. |
| Semantics and updates | Headings, labeled controls, native buttons and dialogs, named tab panels, a focusable conversation log, status announcements for search and data loading, and explicit pending/error states. Relevant: 3.2.1, 3.2.2, 4.1.2, 4.1.3. |

## Verification

Browser QA covers desktop, laptop, 390px and 320px phone layouts, and a 360px reflow layout. It exercises keyboard-only city selection, tab switching, directory filtering and selection, panel minimization, dialog focus restoration, click-to-pan controls, reduced motion, chat tab containment and return focus, empty and populated comparison charts, and external-tile failure.

Automated accessibility checks use axe-core's WCAG 2 A/AA, WCAG 2.1 A/AA, and WCAG 2.2 AA tags across the welcome, selected-city, directory, Display options, and companion states. Icon-only controls may require manual review of accessible names and contrast rather than an automated text verdict. An automated pass is not proof of conformance.

On 2026-10-24, axe-core 4.14.0 reported no automated violations in 20 tested interface states. The suite included a short landscape screen, independent 200% text sizing, and text-spacing overrides. The remaining automated review items concerned symbolic icon contrast/names; those controls have explicit accessible names and were checked against the color palette. Browser accessibility snapshots include the chart's row labels and unavailable values. Resizing a scrolled phone layout also preserves valid map padding and controls.

Additional checks inspect 200% text sizing, 320px reflow, text-spacing overrides, and browser accessibility semantics. Numeric chart fixtures stay outside the production crime export.

On 2026-10-25, the visual refinement replaced rounded component corners and serif headings with square panels and one system sans-serif family. Caption text is at least 12px at the default root size, with distinct heading and data-value sizes. Search and form borders have 3.72:1 contrast on white; the search border has 3.22:1 contrast against the map's pale blue background. The panel toggle retains a 44px square target.

Chrome and axe-core checks passed in 37 interface states across desktop, 390px and 320px phones, short landscape, independent 200% text sizing, text-spacing overrides, and forced colors. Checks covered keyboard city selection, category radios, dialog focus, the city directory, reduced motion, cited news and its sandboxed source frame, and modal chat. There was no page-width overflow in these states. The forecast pattern and screen-reader data table remain available. These checks do not replace the remaining assistive-technology and usability review.

The subsequent error audit repeated those checks and exercised 20 failure/recovery paths. Search dismissal no longer reopens hidden choices through native search-field behavior. Cancelled chat research clears its busy state, and unverified news has an explicit retry. See [AUDIT.md](./AUDIT.md).

After the partner-data integration on 2026-10-24, Chrome checks also covered the supplied violent/property values, keyboard category switching without focus loss, historical forecast years, Honolulu's unavailable state, data-load failure/retry, chart-to-guide focus transfer, mobile chat containment, and map-dot selection. At 1440×1000, 390×844, 320×568, and 844×390, the tested welcome/comparison/guide states had no axe-core WCAG A/AA violations or page-width overflow. All 644 supplied category records were checked through the actual data provider for matching GEOID, national category, and reporting year. These checks do not independently verify the model or certify accessibility.

## Remaining review

- End-to-end testing with VoiceOver and NVDA, including search-result announcements and chart reading order.
- Usability testing with people who use assistive technology, touch magnification, and alternative input devices.
- Detailed review of the external vector basemap's labels and future model/news content. The map has accessible application alternatives, but external visual content still needs review.
- Re-test real API errors, uncertainty, source links, and live/streaming Gemma output when those services connect.

## References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Dragging movement alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)

The in-site Gemma review uses a native dialog with a loading status, dated source links, retry, and distinct no-news/error states. Desktop and phone browser checks cover these states and chat with axe-core. Local UI QA uses the shared Node handler because this Mac cannot run the Cloudflare emulator; production routes are checked after deployment.
