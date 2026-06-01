# Aria

Aria is a web-based interactive tool, likely designed to facilitate interactions with AI models, manage application state, and provide a rich user interface for tasks such as code review, artifact management, and system prompting. It leverages client-side JavaScript for dynamic functionality and a clean CSS for styling.

## Features (Inferred)

*   **API Interaction:** Seamless communication with backend services or AI models.
*   **User Interface:** Dynamic and responsive UI built with modular components.
*   **State Management:** Efficient handling of application state for a smooth user experience.
*   **File System Operations:** Potentially client-side file handling or interaction with local storage.
*   **Markdown Support:** Rendering and interaction with Markdown content.
*   **Code Review/Diffing:** Tools for comparing and reviewing content.
*   **Subagent Integration:** Possible support for modular sub-agents or specialized functionalities.
*   **System Prompting:** Features related to sending prompts or instructions to a system.

## Technologies Used (Inferred)

*   HTML5
*   CSS3
*   JavaScript (ES6+)

## Getting Started

To run this project, you'll need a web server to serve the static files. You can use any static web server. Here are a few options:

### Using Python's Simple HTTP Server

If you have Python installed, you can quickly start a local server:

1.  Navigate to the project root directory in your terminal:
    ```bash
    cd /Users/maximilianpezzullo/aria
    ```
2.  Run the Python HTTP server:
    ```bash
    python -m http.server 8000
    # Or for Python 2:
    # python -m SimpleHTTPServer 8000
    ```
3.  Open your web browser and go to `http://localhost:8000`.

### Using `serve` (Node.js)

If you have Node.js installed, you can use the `serve` package:

1.  Install `serve` globally (if you haven't already):
    ```bash
    npm install -g serve
    ```
2.  Navigate to the project root directory:
    ```bash
    cd /Users/maximilianpezzullo/aria
    ```
3.  Run `serve`:
    ```bash
    serve .
    ```
4.  Open your web browser and go to the address provided by `serve` (e.g., `http://localhost:3000`).

## Project Structure

```
.
├── index.html
├── styles.css
└── js/
    ├── api.js
    ├── app.js
    ├── artifacts.js
    ├── diff.js
    ├── events.js
    ├── fs.js
    ├── icons.js
    ├── markdown.js
    ├── review.js
    ├── state.js
    ├── subagents.js
    ├── systemPrompt.js
    ├── tools-schema.js
    ├── tools.js
    ├── ui.js
    ├── utils.js
    └── widgets.js
```
