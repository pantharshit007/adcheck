# Configuration Settings

AdCheck allows you to set up precise tracking for different items through the main popup settings. These configurations define what the extension will check on the active page.

## Available Configurations

- **Bundles or script names**: Tell AdCheck which ad scripts should load on the page. You can specify names like `adscript.js`.
- **Page element IDs**: Add IDs for ad slots or wrappers you want to jump to. It verifies if the element exists in the DOM.
- **CSS class names**: Look for page elements that carry these specific class names, ensuring that target items are rendered correctly.
- **Attribute names**: Find values like section IDs or ad unit metadata anywhere in the DOM (e.g., `data-ad-unit`).
- **Cookie names**: Check the browser cookies your ad setup depends on (e.g., `user_id`), ensuring the user session or targeting is populated.
- **Local storage keys**: Verify page storage keys such as session or targeting data.
- **Ignored domains**: Skip AdCheck entirely on matching hostnames. You can specify exact domains or use regular expressions to match patterns (e.g., `example.com` or `google|github\.com`).
- **Window Globals Inspector**: Safely inspect and track values from the page's `window` object. This supports deep-path access and "await bundle" dependencies to ensure data is checked only after certain scripts load.
- **Blocked Routes**: Define network routes that AdCheck should block to simulate environments without certain scripts or network calls. This is useful for ad testing and validation.
