/* eslint-disable @typescript-eslint/no-explicit-any */
import YAML from 'js-yaml'
import fs from 'fs'
import path from 'path'
import jp from 'jsonpath'
import { Options } from './options'
import { formatGuesser, formatParser } from './parser'
import { Octokit } from '@octokit/rest'
import { Actions, EmptyActions } from './github-actions'
import {
  createBlobForFile,
  createNewCommit,
  createNewTree,
  currentCommit,
  repositoryInformation,
  updateBranch
} from './git-commands'
import {
  ChangedFile,
  Committer,
  Format,
  Method,
  ValueUpdates,
  ContentNode
} from './types'

const APPEND_ARRAY_EXPRESSION = '[(@.length)]'

function generateUniqueBranchName(base: string): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
  const random = Math.floor(Math.random() * 100000)
  return `${base}-${timestamp}-${random}`
}

export async function run(options: Options, actions: Actions): Promise<void> {
  if (options.updateFile === true) {
    actions.info(
      'updateFile is deprected, the updated content will be written to the file by default from now on'
    )
  }

  try {
    const files: ChangedFile[] = []

    for (const [file, values] of Object.entries(options.changes)) {
      const changedFile = processFile(file, values, options, actions)

      if (changedFile) {
        writeTo(changedFile.content, changedFile.absolutePath, actions)
        files.push(changedFile)
      }
    }

    actions.debug(`files: ${JSON.stringify(files)}`)

    if (options.commitChange === false || files.length === 0) {
      return
    }

    const octokit = new Octokit({
      auth: options.token,
      baseUrl: options.githubAPI
    })

    // Generate unique branch name
    options.branch = generateUniqueBranchName(options.branch)

    await gitProcessing(
      options.repository,
      options.branch,
      options.force,
      options.masterBranchName,
      files,
      options.message,
      octokit,
      actions,
      options.committer
    )

    if (options.createPR) {
      await createPullRequest(
        options.repository,
        options.branch,
        options.targetBranch,
        options.labels,
        options.title || `Merge: ${options.message}`,
        options.description,
        options.reviewers,
        options.teamReviewers,
        options.assignees,
        octokit,
        actions
      )
    }
  } catch (error) {
    const msg = (error as Error).toString()
    if (msg.includes('pull request already exists')) {
      actions.info('Pull Request already exists')
      return
    }

    actions.setFailed(`failed to create PR: ${msg}`)
  }
}

// ... rest of the file remains unchanged