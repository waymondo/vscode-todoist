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

import { TodoistApi, Task, AddTaskArgs } from "@doist/todoist-api-typescript"
const TodoistClient = new TodoistApi("") // token will be set later

type TaskQPI = Task & { label: string }

type Scope = `project` | `global` | null

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

  TodoistClient.authToken = apiToken
  const projects = await TodoistClient.getProjects()

  const projectQPIs = projects.map((project) =>
    Object.assign(project, {
      label: project.name,
    }),
  )
  const configTarget = scope === `project` ? ConfigurationTarget.Workspace : ConfigurationTarget.Global
  const quickPick = window.createQuickPick()
  quickPick.placeholder = `Choose a Todoist Project for this workspace`

  // @ts-ignore
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

      const project = await TodoistClient.addProject({name: inputString})

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

const makeTaskQPIs = (tasks: Array<Task | TaskQPI>): TaskQPI[] =>
  tasks.map(task => Object.assign(task, { label: taskLabel(task), picked: task.completed }))

const captureTodo = async (scope: Scope = null, nullableProjectId: number | null = null) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId =  nullableProjectId == null ?
  	await getOrCreateProjectId(apiToken, `extension.todoistList`, scope) :
	  nullableProjectId
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

const listTodos = async (scope: Scope = null, nullableProjectId: number | null = null) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId =  nullableProjectId == null ?
  	await getOrCreateProjectId(apiToken, `extension.todoistList`, scope) :
	  nullableProjectId
  if (!projectId) {
    return
  }

  TodoistClient.authToken = apiToken
  const tasks = await TodoistClient.getTasks({projectId})

  let quickPickItems = makeTaskQPIs(tasks)
  const quickPick = window.createQuickPick<TaskQPI>()
  quickPick.items = quickPickItems
  quickPick.onDidChangeSelection(items => {
    const itemIds = items.map(item => item.id)

    quickPick.items.forEach((item: TaskQPI) => {
      if (itemIds.includes(item.id)) {
        const completed = !item.completed
        item.completed = completed
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

const openProject = async (scope: Scope, nullableProjectId: number | null = null) => {
  const apiToken = getApiToken()
  if (!apiToken) {
    return
  }

  const projectId =  nullableProjectId == null ?
  	await getOrCreateProjectId(apiToken, `extension.todoistList`, scope) :
	  nullableProjectId
  if (!projectId) {
    return
  }

  env.openExternal(Uri.parse(`todoist://project?id=${projectId}`))
}

export function activate(context: ExtensionContext) {
  const todoistCaptureProject = commands.registerCommand(`extension.todoistCaptureProject`, () => {
    captureTodo(`project`, null)
  })
  const todoistCaptureGlobal = commands.registerCommand(`extension.todoistCaptureGlobal`, () => {
    captureTodo(`global`, null)
  })
  const todoistCaptureId = commands.registerCommand(`extension.todoistCaptureId`, (projectId: number) => {
	  captureTodo(null, projectId)
  })

  const todoistTodosProject = commands.registerCommand(`extension.todoistTodosProject`, () => {
    listTodos(`project`, null)
  })
  const todoistTodosGlobal = commands.registerCommand(`extension.todoistTodosGlobal`, () => {
    listTodos(`global`, null)
  })
  const todoistTodosId = commands.registerCommand(`extension.todoistTodosId`, (projectId: number) => {
	  listTodos(null, projectId)
  })

  const todoistOpenProject = commands.registerCommand(`extension.todoistOpenProject`, () => {
    openProject(`project`, null)
  })
  const todoistOpenGlobal = commands.registerCommand(`extension.todoistOpenGlobal`, () => {
    openProject(`global`, null)
  })
  const tododistOpenId = commands.registerCommand(`extension.todoistOpenId`, (projectId: number) => {
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
