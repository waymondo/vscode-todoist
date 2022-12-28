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

const getApiToken = function() {
  const apiToken: string | undefined = workspace.getConfiguration().get(`todoist.apiToken`)
  if (!apiToken) {
    window.showInformationMessage(`Set your Todoist API token`)
  }
  return apiToken
}

async function getOrCreateProjectId(apiToken: string, command: string, scope: Scope) {
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
  const quickPick = window.createQuickPick<ProjectQPI | { label: string, id: null } >()
  quickPick.placeholder = `Choose a Todoist Project for this workspace`

  quickPick.items = [...projectQPIs, { label: `Create a new project`, id: null }]
  quickPick.onDidChangeSelection(async items => {
    projectId = items[0].id
    if (projectId) {
      await workspace.getConfiguration().update(`todoist.projectId`, projectId, configTarget)
      commands.executeCommand(command)
    } else {
      const inputString = await window.showInputBox({ placeHolder: `Enter Todoist Project Name` })
      if (!inputString) {
        return
      }

      const project = await TodoistClient.addProject({ name: inputString })

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
  const statusBox = task.isCompleted ? "✅" : "🟩"
  return `${statusBox} ${task.content}`
}

const makeTaskQPIs = (tasks: Array<Task | TaskQPI>): TaskQPI[] =>
  tasks.map(task => Object.assign(task, { label: taskLabel(task), picked: task.isCompleted }))

const captureTodo = async (scope: Scope = null, customProjectId?: string) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId = customProjectId
    ? customProjectId
    : await getOrCreateProjectId(apiToken, `extension.todoistList`, scope)

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
    inputBoxOptions.value = `\n ${env.uriScheme}://file/${fileName}:${lineNumber}`
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
  const task = await TodoistClient.addTask(body)

  if (task.id) {
    window.showInformationMessage(`Task Created`)
  } else {
    window.showWarningMessage(`There was an error`)
  }
}

const listTodos = async (scope: Scope = null, customProjectId?: string) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId =  customProjectId
    ? customProjectId
  	: await getOrCreateProjectId(apiToken, `extension.todoistList`, scope)

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

const openProject = async (scope: Scope, customProjectId?: string) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId =  customProjectId
    ? customProjectId
    : await getOrCreateProjectId(apiToken, `extension.todoistList`, scope)

  if (!projectId) {
    return
  }

  env.openExternal(Uri.parse(`todoist://project?id=${projectId}`))
}

export function activate(context: ExtensionContext) {
  const todoistCaptureProject = commands.registerCommand(`extension.todoistCaptureProject`, () => {
    captureTodo(`project`)
  })
  const todoistCaptureGlobal = commands.registerCommand(`extension.todoistCaptureGlobal`, () => {
    captureTodo(`global`)
  })
  const todoistCaptureId = commands.registerCommand(`extension.todoistCaptureId`, (projectId: string) => {
	  captureTodo(null, projectId)
  })

  const todoistTodosProject = commands.registerCommand(`extension.todoistTodosProject`, () => {
    listTodos(`project`)
  })
  const todoistTodosGlobal = commands.registerCommand(`extension.todoistTodosGlobal`, () => {
    listTodos(`global`)
  })
  const todoistTodosId = commands.registerCommand(`extension.todoistTodosId`, (projectId: string) => {
	  listTodos(null, projectId)
  })

  const todoistOpenProject = commands.registerCommand(`extension.todoistOpenProject`, () => {
    openProject(`project`)
  })
  const todoistOpenGlobal = commands.registerCommand(`extension.todoistOpenGlobal`, () => {
    openProject(`global`)
  })
  const tododistOpenId = commands.registerCommand(`extension.todoistOpenId`, (projectId: string) => {
    openProject(null, projectId)
  })

  context.subscriptions.push(todoistCaptureProject)
  context.subscriptions.push(todoistCaptureGlobal)
  context.subscriptions.push(todoistCaptureId)
  context.subscriptions.push(todoistTodosProject)
  context.subscriptions.push(todoistTodosGlobal)
  context.subscriptions.push(todoistTodosId)
  context.subscriptions.push(todoistOpenProject)
  context.subscriptions.push(todoistOpenGlobal)
  context.subscriptions.push(tododistOpenId)
}

export function deactivate() {
  // unregister handler?
}
