# Side Panel Widget

The **Side Panel Widget** is an in-page floating helper designed to give you instant, real-time feedback on ad-related elements directly on the publisher's website.

## Key Features

- **Real-Time Visibility**: It surfaces the status of your ad slots, network requests, and custom configuration checks right in your browser tab without having to switch to a different window or the Chrome DevTools.
- **Collapsible and Configurable**: You can expand or collapse the widget to keep it out of the way when you are not actively using it. The extension remembers the side of the screen (`↔`) and your theme preference (`Auto`, `Dark`, or `Light`).
- **Style Isolation & Dark Mode**: The widget renders inside a Shadow DOM so host-page CSS resets and fonts cannot break its layout. In `Auto` mode, it adapts to dark-mode websites and your OS theme automatically.
- **Status Indicators**: It provides clear pass/fail status updates for all the tracked DOM IDs, CSS Classes, Attributes, and other settings configured in your main popup.
- **Interactive Feedback**: Click elements within the widget to jump to ad slots or interact with the page without intrusive tooltips.

## Usage
Simply toggle the extension on from the popup, and the widget will appear on all non-ignored domains. It will present real-time DOM status and network tracking data based on the features enabled in your settings.
