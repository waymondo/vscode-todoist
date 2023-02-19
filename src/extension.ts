import {
  commands,
  window,
  workspace,
  ExtensionContext,
  Uri,
  env,
  ConfigurationTarget,
  InputBoxOptions
} from "vscode"

import { TodoistApi, Task, Project, AddTaskArgs } from "@doist/todoist-api-typescript"
const TodoistClient = new TodoistApi("") // token will be set later

type TaskQPI = Task & { label: string }
type ProjectQPI = Project & { label: string }

type Scope = `project` | `global` | null

const getApiToken = async (context: ExtensionContext) => {
  const apiToken = await context.secrets.get(`todoistApiToken`)

  if (apiToken) {
    return apiToken
  }

  const newApiToken = await window.showInputBox({ placeHolder: `Enter your Todoist API Token`, password: true })

  if (!newApiToken) {
    return null
  }
  context.secrets.store(`todoistApiToken`, newApiToken)

  return newApiToken
}

const getOrCreateProjectId = async ({ apiToken, scope }: { apiToken: string, scope: Scope }) => {
  if (scope === `project` && !workspace.workspaceFolders) {
    window.showWarningMessage(`Not within a workspace`)
    return null
  }

  let projectId = workspace.getConfiguration().get(`todoist.projectId`)
  if (projectId) {
    return typeof projectId === "number" ? String(projectId) : (projectId as string)
  }

  TodoistClient.authToken = apiToken
  const projects = await TodoistClient.getProjects()

  const projectQPIs = projects.map((project) =>
    Object.assign(project, {
      label: project.name,
    }),
  )
  const configTarget = scope === `project` ? ConfigurationTarget.Workspace : ConfigurationTarget.Global
  const quickPick = window.createQuickPick<ProjectQPI | { label: string, id: null }>()
  quickPick.placeholder = `Choose a Todoist Project for this workspace`

  quickPick.items = [...projectQPIs, { label: `Create a new project`, id: null }]
  quickPick.onDidChangeSelection(async items => {
    projectId = items[0].id
    if (projectId) {
      await workspace.getConfiguration().update(`todoist.projectId`, projectId, configTarget)
    } else {
      const inputString = await window.showInputBox({ placeHolder: `Enter Todoist Project Name` })
      if (!inputString) {
        return
      }

      const project = await TodoistClient.addProject({ name: inputString })

      await workspace.getConfiguration().update(`todoist.projectId`, project.id, configTarget)
    }
    quickPick.dispose()
  })
  quickPick.onDidHide(() => quickPick.dispose())
  quickPick.show()
  return null
}

const taskLabel = (task: Task) => {
  const statusBox = task.isCompleted ? "✅" : "🟩"
  return `${statusBox} ${task.content}`
}

const makeTaskQPIs = (tasks: Array<Task | TaskQPI>): TaskQPI[] =>
  tasks.map(task => Object.assign(task, { label: taskLabel(task), picked: task.isCompleted }))

type CommandOptions = {
  context: ExtensionContext,
  scope?: Scope,
  customProjectId?: string,
}

const captureTodo = async ({ scope = null, customProjectId, context }: CommandOptions) => {
  const apiToken = await getApiToken(context)
  if (!apiToken) {
    return
  }

  const projectId = customProjectId
    ? customProjectId
    : await getOrCreateProjectId({ apiToken, scope })

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
    const lineNumber = activeSelection.start.line + 1 // zero-based
    inputBoxOptions.value = ` - [🔗 Go to File](${env.uriScheme}://file/${fileName}:${lineNumber})`
  }
  const inputString = await window.showInputBox(inputBoxOptions)
  if (!inputString) {
    return
  }

  let body: AddTaskArgs = {
    content: activeSelection ? `${inputString} ` : inputString,
    projectId,
  }

  TodoistClient.authToken = apiToken

  const task = await TodoistClient.addTask(body).catch(() => null)

  if (!task) {
    return window.showWarningMessage(`There was an error creating the task`)
  }

  const actionMessage = `Open in Todoist`
  const userResponse = await window.showInformationMessage(`Task Created`, actionMessage)

  if (userResponse === actionMessage) {
    env.openExternal(Uri.parse(`todoist://project?id=${task.projectId}`))
  }
}

const listTodos = async ({ scope = null, customProjectId, context }: CommandOptions) => {
  const apiToken = await getApiToken(context)
  if (!apiToken) {
    return
  }

  const projectId = customProjectId
    ? customProjectId
    : await getOrCreateProjectId({ apiToken, scope })

  if (!projectId) {
    return
  }

  TodoistClient.authToken = apiToken
  const tasks = await TodoistClient.getTasks({ projectId })

  let quickPickItems = makeTaskQPIs(tasks)
  const quickPick = window.createQuickPick<TaskQPI>()
  quickPick.items = quickPickItems
  quickPick.onDidChangeSelection(items => {
    const itemIds = items.map(item => item.id)

    quickPick.items.forEach((item: TaskQPI) => {
      if (itemIds.includes(item.id)) {
        const completed = !item.isCompleted
        item.isCompleted = completed
        completed
          ? TodoistClient.closeTask(item.id)
          : TodoistClient.reopenTask(item.id)
      }
    })
    quickPick.items = makeTaskQPIs(quickPickItems)
  })
  quickPick.onDidHide(() => quickPick.dispose())
  quickPick.show()
}

const openProject = async ({ scope = null, customProjectId, context }: CommandOptions) => {
  const apiToken = await getApiToken(context)
  if (!apiToken) {
    return
  }

  const projectId = customProjectId
    ? customProjectId
    : await getOrCreateProjectId({ apiToken, scope })

  if (!projectId) {
    return
  }

  env.openExternal(Uri.parse(`todoist://project?id=${projectId}`))
}

const getCommandHandlers = (context: ExtensionContext) => ({
  "extension.todoistCaptureProject": () => captureTodo({ scope: "project", context }),
  "extension.todoistCaptureGlobal": () => captureTodo({ scope: "global", context }),
  "extension.todoistCaptureId": (projectId: string) => captureTodo({ customProjectId: projectId, context }),

  "extension.todoistTodosProject": () => listTodos({ scope: "project", context }),
  "extension.todoistTodosGlobal": () => listTodos({ scope: "global", context }),
  "extension.todoistTodosId": (projectId: string) => listTodos({ customProjectId: projectId, context }),

  "extension.todoistOpenProject": () => openProject({ scope: "project", context }),
  "extension.todoistOpenGlobal": () => openProject({ scope: "global", context }),
  "extension.todoistOpenId": (projectId: string) => openProject({ customProjectId: projectId, context }),
})

export function activate(context: ExtensionContext) {
  const commandHandlers = getCommandHandlers(context)

  Object.entries(commandHandlers).forEach(([command, handler]) => {
    const disposable = commands.registerCommand(command, handler)
    context.subscriptions.push(disposable)
  })
}

export function deactivate() {
  // unregister handler?
}
