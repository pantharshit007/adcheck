# Site Overrides & Global Actions

These features fall outside of the standard inspection settings and offer powerful ways to modify page behavior or globally manage the extension.

## Current Site Override

The **Site Override** feature lets you safely test custom tags or HTML on a specific page by injecting them locally into the DOM.

- **Element Picker**: Use the built-in visual element picker to select an exact DOM element on any page. You can launch the picker from the popup and click an element directly on the site.
- **Custom Injection**: Write custom HTML snippets or loader scripts.
- **Placement Options**: Choose exactly where to inject your custom code relative to the picked element:
  - `beforebegin`: Before the element itself.
  - `afterbegin`: Just inside the element, before its first child.
  - `beforeend`: Just inside the element, after its last child.
  - `afterend`: After the element itself.
- **Safety Warning**: If your snippet includes `<script>` tags, the popup will check whether the "Allow access to user scripts" permission is granted in Chrome's extension settings.

## Global Actions

- **Global Toggle**: At the very top of the popup, you can globally enable or disable AdCheck. When paused, AdCheck ceases to execute checks, widget UI, or inject scripts across all sites.
- **Import/Export Settings**: Allows you to easily share and backup your configurations as JSON payloads. Note that site-specific overrides do not get exported since they are domain-dependent.
