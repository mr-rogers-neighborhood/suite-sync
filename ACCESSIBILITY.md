# Accessibility

Suite Sync is a headless relay. It has no window, no interface and no interaction, so almost all
of WCAG does not apply to it.

The accessibility work for this project lives in the applications, which are where people actually
meet it. Their statements are in each app repository, and the shared criterion map is in
[`suite-dev/docs/accessibility/wcag-22-map.md`](https://github.com/mr-rogers-neighborhood/suite-dev/blob/main/docs/accessibility/wcag-22-map.md).

## What this service does

It moves encrypted documents between devices on a local network. There is nothing to see, click,
read or focus.

## What that means for WCAG 2.2

- **Perceivable, Operable, Understandable.** Not applicable: there is no content and no user
  interface. The criteria in principles 1 to 3 describe things a person perceives or operates, and
  this process offers neither.
- **Robust (SC 4.1.2, 4.1.3).** Not applicable: no markup, no accessibility tree, no status message
  delivered to a person. Its log lines are read by a developer in a terminal.
- **Obsolete.** SC 4.1.1 Parsing was removed in WCAG 2.2.

## The one thing worth saying

The relay is only reachable from the apps, and the apps are where a person would be blocked. If
the relay misbehaves, the app that talks to it shows the failure in its own interface, and that
interface is covered by the app's statement and the shared testing protocol.

## Telling us about a barrier

Open an issue on whichever repository you were using when it happened. If it was an app, say which
one. That is more useful than guessing at the layer.
