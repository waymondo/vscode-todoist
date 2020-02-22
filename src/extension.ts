import { commands, window, workspace, ExtensionContext, Uri, env } from 'vscode'
import fetch from "node-fetch"

const HOST = `https://api.todoist.com/rest/v1`

const getApiToken = function() {
  const apiToken: string | undefined = workspace.getConfiguration().get(`todoist.apiToken`)
  if (!apiToken) {
    window.showInformationMessage(`Set your Todoist API token`)
  }
  return apiToken
}

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

type TaskQPI = Task & {
	label: string
	description: string | undefined
	detail: string | undefined
	picked: boolean
}

export function activate(context: ExtensionContext) {
  const todoistProjectCapture = commands.registerCommand(
    `extension.todoistProjectCapture`,
    async () => {
      const apiToken = getApiToken()
      if (!apiToken) {
        return
      }

      const projectId: string | undefined = workspace.getConfiguration().get(`todoist.projectId`)
      const inputString = await window.showInputBox({ placeHolder: `Enter Todo` })
      if (!inputString) {
        return
      }
      const body = projectId
        ? {
            project_id: parseInt(projectId),
            content: inputString,
          }
        : {
            content: inputString,
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
    },
  )

  const todoistListTodos = commands.registerCommand(`extension.todoistListTodos`, async () => {
    const apiToken = getApiToken()
    if (!apiToken) {
      return
    }

    const projectId: string | undefined = workspace.getConfiguration().get(`todoist.projectId`)
    const path = projectId ? `/tasks?project_id=${projectId}` : `/tasks`
    const response = await fetch(HOST + path, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    })
		const tasks = await response.json()

		const taskLabel = (task: Task) => {
			const statusBox = task.completed ? String.fromCodePoint(parseInt(`2705`, 16)) : String.fromCodePoint(parseInt(`1F7E9`, 16))
      return `${statusBox} ${task.content}`
		}

		const makeTaskQPIs = (tasks: Array<Task | TaskQPI>) => (
			tasks.map(task => (
				Object.assign(
					task,
					{ label: taskLabel(task),
						detail: `${task.project_id}`,
						picked: task.completed,
						description: `${task.project_id}`,
					 },
				)
			))
		)

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
  })

  const todoistProjectOpen = commands.registerCommand(`extension.todoistProjectOpen`, async () => {
    const apiToken = getApiToken()
    if (!apiToken) {
      return
    }
    const projectId: string | undefined = workspace.getConfiguration().get(`todoist.projectId`)
    env.openExternal(Uri.parse(`todoist://project?id=${projectId}`))
  })

  context.subscriptions.push(todoistProjectCapture)
  context.subscriptions.push(todoistListTodos)
  context.subscriptions.push(todoistProjectOpen)
}

export function deactivate() {}
