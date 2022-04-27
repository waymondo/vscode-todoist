import {
  commands,
  window,
  workspace,
  ExtensionContext,
  Uri,
  env,
  ConfigurationTarget,
  InputBoxOptions,
  UriHandler,
  Range,
  Selection,
} from "vscode"
import fetch from "node-fetch"

const EXTENSION_ID = `waymondo.todoist`
const HOST = `https://api.todoist.com/rest/v1`

type Task = {
  id: number
  project_id: number | null
  section_id: number
  order: number
  content: string
  completed: boolean
  label_ids: number[]
  priority: number
  create: string
  url: string
}

type Project = {
  id: number
  order: number
  color: number
  name: string
  comment_count: number
}

type TaskQPI = Task & {
  label: string
  description: string | undefined
  detail: string | undefined
  picked: boolean
}

type TaskRequestBody = {
  content: string
  project_id?: number
}

type Scope = `project` | `global`

const getApiToken = function() {
  const apiToken: string | undefined = workspace.getConfiguration().get(`todoist.apiToken`)
  if (!apiToken) {
    window.showInformationMessage(`Set your Todoist API token`)
  }
  return apiToken
}

const getOrCreateProjectId = async function(apiToken: string, command: string, scope: Scope): Promise<number | null> {
  if (scope === `project` && !workspace.workspaceFolders) {
    window.showWarningMessage(`Not within a workspace`)
    return null
  }

  let projectId = workspace.getConfiguration().get(`todoist.projectId`)
  if (projectId) {
    return typeof projectId === `string` ? parseInt(projectId) : (projectId as number)
  }
  const response = await fetch(HOST + `/projects`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  })
  const projects = await response.json()
  const projectQPIs = projects.map((project: Project) =>
    Object.assign(project, {
      label: project.name,
    }),
  )
  const configTarget = scope === `project` ? ConfigurationTarget.Workspace : ConfigurationTarget.Global
  const quickPick = window.createQuickPick()
  quickPick.placeholder = `Choose a Todoist Project for this workspace`
  quickPick.items = projectQPIs.concat([{ label: `Create a new project` }])
  quickPick.onDidChangeSelection(async items => {
    // @ts-ignore
    projectId = items[0].id
    if (projectId) {
      await workspace.getConfiguration().update(`todoist.projectId`, projectId, configTarget)
      commands.executeCommand(command)
    } else {
      const inputString = await window.showInputBox({ placeHolder: `Enter Todoist Project Name` })
      if (!inputString) {
        return
      }
      const response = await fetch(HOST + `/projects`, {
        method: `POST`,
        body: JSON.stringify({
          name: inputString,
        }),
        headers: {
          "Content-Type": `application/json`,
          Authorization: `Bearer ${apiToken}`,
        },
      })
      const project = await response.json()
      await workspace.getConfiguration().update(`todoist.projectId`, project.id, configTarget)
      commands.executeCommand(command)
    }
    quickPick.dispose()
  })
  quickPick.onDidHide(() => quickPick.dispose())
  quickPick.show()
  return null
}

const taskLabel = (task: Task) => {
  const statusBox = task.completed
    ? String.fromCodePoint(parseInt(`2705`, 16))
    : String.fromCodePoint(parseInt(`1F7E9`, 16))
  return `${statusBox} ${task.content}`
}

const makeTaskQPIs = (tasks: Array<Task | TaskQPI>) =>
  tasks.map(task => Object.assign(task, { label: taskLabel(task), picked: task.completed }))

const uriHandler: UriHandler = {
  handleUri: async (uri: Uri) => {
    const { path, fragment } = uri
    let [startLine, endLine] = fragment?.split(`-`).map(number => number && parseInt(number))
    const goToRange = !!startLine
    if (!startLine) {
      startLine = 1
    }
    if (!endLine) {
      endLine = startLine
    }
    const textDocument = await workspace.openTextDocument(path)

    await window.showTextDocument(textDocument)
    const range = new Range(startLine - 1, 0, endLine - 1, 0)
    const editor = window.activeTextEditor
    if (!editor) {
      return
    }
    if (goToRange) {
      editor.selection = new Selection(range.start, range.end)
      editor.revealRange(range)
    }
  },
}

const captureTodo = async (scope: Scope) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId = await getOrCreateProjectId(apiToken, `extension.todoistCapture`, scope)
  if (!projectId) {
    return
  }

  const activeSelection = window.activeTextEditor?.selection
  const inputBoxOptions: InputBoxOptions = {
    prompt: `Enter Todo`,
    valueSelection: [0, 0],
  }
  if (activeSelection && !activeSelection.isEmpty && env.appHost === "desktop") { // only use file url for desktop
    const fileName = window.activeTextEditor?.document.fileName
    const lineNumber = activeSelection.start.line
    inputBoxOptions.value = `\n ${env.uriScheme}://${EXTENSION_ID}/${fileName}#${lineNumber}`
  }
  const inputString = await window.showInputBox(inputBoxOptions)
  if (!inputString) {
    return
  }

  let body: TaskRequestBody = {
    content: activeSelection ? `${inputString} ` : inputString,
  }
  if (projectId) {
    body.project_id = projectId
  }
  const response = await fetch(HOST + `/tasks`, {
    method: `POST`,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": `application/json`,
      Authorization: `Bearer ${apiToken}`,
    },
  })
  const task = await response.json()
  if (task.id) {
    window.showInformationMessage(`Task Created`)
  } else {
    window.showWarningMessage(`There was an error`)
  }
}

const listTodos = async (scope: Scope) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId = await getOrCreateProjectId(apiToken, `extension.todoistCapture`, scope)
  if (!projectId) {
    return
  }

  const path = projectId ? `/tasks?project_id=${projectId}` : `/tasks`
  const response = await fetch(HOST + path, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  })
  const tasks = await response.json()

  let quickPickItems = makeTaskQPIs(tasks)
  const quickPick = window.createQuickPick()
  quickPick.items = quickPickItems
  quickPick.onDidChangeSelection(items => {
    // @ts-ignore
    const itemIds = items.map(item => item.id)
    // @ts-ignore
    quickPick.items.forEach((item: TaskQPI) => {
      if (!itemIds.includes(item.id)) {
        const completed = !item.completed
        item.completed = completed
        const requestVerb = completed ? `close` : `reopen`
        fetch(HOST + `/tasks/${item.id}/${requestVerb}`, {
          method: `POST`,
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        })
      }
    })
    quickPick.items = makeTaskQPIs(quickPickItems)
  })
  quickPick.onDidHide(() => quickPick.dispose())
  quickPick.show()
}

const openProject = async (scope: Scope) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId = await getOrCreateProjectId(apiToken, `extension.todoistCapture`, scope)
  if (!projectId) {
    return
  }

  env.openExternal(Uri.parse(`todoist://project?id=${projectId}`))
}

export function activate(context: ExtensionContext) {
  window.registerUriHandler(uriHandler)

  const todoistCaptureProject = commands.registerCommand(`extension.todoistCaptureProject`, () => {
    captureTodo(`project`)
  })
  const todoistCaptureGlobal = commands.registerCommand(`extension.todoistCaptureGlobal`, () => {
    captureTodo(`global`)
  })

  const todoistTodosProject = commands.registerCommand(`extension.todoistTodosProject`, () => {
    listTodos(`project`)
  })
  const todoistTodosGlobal = commands.registerCommand(`extension.todoistTodosGlobal`, () => {
    listTodos(`global`)
  })

  const todoistOpenProject = commands.registerCommand(`extension.todoistOpenProject`, () => {
    openProject(`project`)
  })
  const todoistOpenGlobal = commands.registerCommand(`extension.todoistOpenGlobal`, () => {
    openProject(`global`)
  })

  context.subscriptions.push(todoistCaptureProject)
  context.subscriptions.push(todoistCaptureGlobal)
  context.subscriptions.push(todoistTodosProject)
  context.subscriptions.push(todoistTodosGlobal)
  context.subscriptions.push(todoistOpenProject)
  context.subscriptions.push(todoistOpenGlobal)
}

export function deactivate() {
  // unregister handler?
}
