const ALLOWED_EVENTS = ['pull_request', 'pull_request_target'];

async function run(dependencyOverrides) {
    let core;

    try {
        const { core: loadedCore, github } = dependencyOverrides || await loadDependencies();
        core = loadedCore;

        const context = github.context;
        if (shouldSkipEvent(context)) {
            return;
        }

        if (shouldSkipNonForkPullRequest(context)) {
            return;
        }

        const labelName = core.getInput('label');
        if (!pullRequestHasLabel(context, labelName)) {
            console.log(`Pull request does not have the "${labelName}" label, skipping.`);
            return;
        }

        const token = core.getInput('repo-token');
        await removeLabel({ context, github, token, labelName });
        console.log(`Removed the "${labelName}" label from pull request.`);
    } catch (error) {
        // This action is intentionally idempotent and can race with other jobs.
        if (isLabelAlreadyGoneError(error)) {
            console.log('Label was removed during the execution of the action, skipping.');
            return;
        }

        if (core && typeof core.setFailed === 'function') {
            core.setFailed(getFailureMessage(error));
            return;
        }

        throw error;
    }
}

async function loadDependencies() {
    const [core, github] = await Promise.all([
        import('@actions/core'),
        import('@actions/github'),
    ]);

    return { core, github };
}

function shouldSkipEvent(context) {
    if (ALLOWED_EVENTS.includes(context.eventName)) {
        return false;
    }

    console.log(
        `Event "${context.eventName}", skipping. This action only works with the following events: ${ALLOWED_EVENTS.join(', ')}.`,
    );
    return true;
}

function shouldSkipNonForkPullRequest(context) {
    const headRepoFullName = context.payload?.pull_request?.head?.repo?.full_name;
    const baseRepoFullName = context.payload?.repository?.full_name;

    if (!headRepoFullName || !baseRepoFullName) {
        throw new Error('Missing pull request repository metadata in workflow payload.');
    }

    if (headRepoFullName !== baseRepoFullName) {
        return false;
    }

    console.log('Pull request is not from a fork, skipping.');
    return true;
}

function pullRequestHasLabel(context, labelName) {
    const labels = context.payload?.pull_request?.labels;
    if (!Array.isArray(labels)) {
        throw new Error('Missing pull request labels in workflow payload.');
    }

    return labels.some((label) => label?.name === labelName);
}

function isLabelAlreadyGoneError(error) {
    return error?.message === 'Label does not exist' || error?.status === 404;
}

function getFailureMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

async function removeLabel({ context, github, token, labelName }) {
    const octokit = github.getOctokit(token);
    await octokit.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
        name: labelName,
    });
}

// Export is only used for testing
module.exports = run;
module.exports.loadDependencies = loadDependencies;
module.exports._internals = {
    ALLOWED_EVENTS,
    getFailureMessage,
    isLabelAlreadyGoneError,
    pullRequestHasLabel,
    shouldSkipEvent,
    shouldSkipNonForkPullRequest,
};

if (require.main === module) {
    run();
}
