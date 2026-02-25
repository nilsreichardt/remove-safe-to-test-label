async function loadDependencies() {
    const [core, github] = await Promise.all([
        import('@actions/core'),
        import('@actions/github'),
    ]);

    return { core, github };
}

async function run(dependencyOverrides) {
    let core;

    try {
        const { core: loadedCore, github } = dependencyOverrides || await loadDependencies();
        core = loadedCore;

        const context = github.context;

        const allowedEvents = ['pull_request', 'pull_request_target'];
        const isNotAllowedEvent = allowedEvents.indexOf(context.eventName) === -1;
        if (isNotAllowedEvent) {
            console.log(`Event "${context.eventName}", skipping. This action only works with the following events: ${allowedEvents.join(', ')}.`);
            return;
        }

        const headRepoFullName = context.payload.pull_request.head.repo.full_name;
        const baseRepoFullName = context.payload.repository.full_name;

        const isFork = headRepoFullName !== baseRepoFullName;
        if (!isFork) {
            console.log(`Pull request is not from a fork, skipping.`);
            return;
        }

        const safeToTestLabelName = core.getInput('label');

        // Check if pull request has the "safe to test" label
        const labels = context.payload.pull_request.labels;
        const safeToTestLabel = labels.find(label => label.name === safeToTestLabelName);
        if (!safeToTestLabel) {
            console.log(`Pull request does not have the "safe-to-test" label, skipping.`);
            return;
        }

        // Remove the "safe-to-test" label
        const token = core.getInput('repo-token');
        const octokit = new github.getOctokit(token);
        await octokit.rest.issues.removeLabel({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.payload.pull_request.number,
            name: safeToTestLabelName,
        });
        console.log(`Removed the "safe-to-test" label from pull request.`);
    } catch (error) {
        // When multiple actions are executed in a workflow, the action may try
        // to remove a label that was already removed by another action (race
        // condition).
        if (error.message === 'Label does not exist') {
            console.log('Label was removed during the execution of the action, skipping.');
            return;
        }

        if (core && typeof core.setFailed === 'function') {
            core.setFailed(error.message);
            return;
        }

        throw error;
    }
}

// Export is only used for testing
module.exports = run;
module.exports.loadDependencies = loadDependencies;

if (require.main === module) {
    run();
}
