# VSCode Todoist

Track and sync your development todos with [Todoist](https://todoist.com), right in VSCode!

## Features & Usage

![Animation]()

Todoist "projects" are scoped to VSCode "workspaces". If you are not within a workspace, the global value of `todoist.projectId` will be used.

Whenever you invoke a command, if a Todoist project is not set for your workspace or globally, you will be prompted to choose or create a Todoist project.

This VSCode extension adds several commands to the command palette:

### Todoist Capture

Default Keybinding <kbd>alt+t c</kbd>.

Pop open an input box to capture a todo. If you have a text selection made when this is invoked, it will pre-populate the input field with a link to your current file and line number, for easy deep linking from the Todoist desktop app.

### Todoist Todos

Default Keybinding <kbd>alt+t t</kbd>.

Shows all the incomplete todos in your current Todoist project. Selecting an item will toggle its completeness. Press <kbd>Esc</kbd> to dismiss the list.

### Todoist Open

Default Keybinding <kbd>alt+t o</kbd>.

If you have the Todoist desktop app installed, this will open or switch to the Todoist app and select your current project.

## Requirements & Installation

Obviously this requires a [Todoist](https://todoist.com) account. To use "Todoist Open" and take advantage of the deep linking feature, you will also need the Todoist desktop app.

To install this extension, open the command palette and enter:

```
ext install waymondo.todoist
```

Finally, set the `todoist.apiToken` setting to your Todoist API token which can be found [here](https://todoist.com/prefs/integrations).

If you would like to set a global Todoist Project ID to capture all todos when not in a workspace, set `todoist.projectId` in your user settings as well.

## Project Goals & Motivation

* Create a simple and lightweight method of capturing and organizing tasks on a per-project basis.

* Leverage a well-featured todo app service instead of re-invent the wheel.

* Todoist is a good candidate for such a service, since you can easily stay in touch with your todos on the go with their mobile apps.

* Implement a way where the basic features can be used strictly from within VSCode.

## Known Issues

I have not yet tested on any platforms other than macOS.
