const run = require('./index');

describe('remove-safe-to-test-label', () => {
    let consoleSpy;

    beforeEach(() => {
        consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        jest.resetAllMocks();
    });

    test('removes the configured label for fork pull requests', async () => {
        const { core, github, removeLabelMock } = setup();

        await run({ core, github });

        expect(github.getOctokit).toHaveBeenCalledWith('fake-token');
        expect(removeLabelMock).toHaveBeenCalledWith({
            owner: 'base-owner',
            repo: 'repo',
            issue_number: 1,
            name: 'safe-to-test',
        });
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('skips pull requests that are not from forks', async () => {
        const { core, github, removeLabelMock } = setup({
            context: buildContext({
                payload: {
                    pull_request: {
                        head: {
                            repo: {
                                full_name: 'base-owner/repo',
                            },
                        },
                        labels: [{ name: 'safe-to-test' }],
                        number: 1,
                    },
                    repository: {
                        full_name: 'base-owner/repo',
                    },
                },
            }),
        });

        await run({ core, github });

        expect(github.getOctokit).not.toHaveBeenCalled();
        expect(removeLabelMock).not.toHaveBeenCalled();
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('skips unsupported events', async () => {
        const { core, github, removeLabelMock } = setup({
            context: buildContext({ eventName: 'workflow_dispatch' }),
        });

        await run({ core, github });

        expect(github.getOctokit).not.toHaveBeenCalled();
        expect(removeLabelMock).not.toHaveBeenCalled();
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('skips when the configured label is not present', async () => {
        const { core, github, removeLabelMock } = setup({
            label: 'qa-approved',
        });

        await run({ core, github });

        expect(github.getOctokit).not.toHaveBeenCalled();
        expect(removeLabelMock).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            'Pull request does not have the "qa-approved" label, skipping.',
        );
    });

    test('handles already-removed label race conditions by message', async () => {
        const { core, github } = setup({
            removeLabel: jest.fn().mockRejectedValue(new Error('Label does not exist')),
        });

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            'Label was removed during the execution of the action, skipping.',
        );
    });

    test('handles already-removed label race conditions by status code', async () => {
        const statusError = new Error('Not Found');
        statusError.status = 404;

        const { core, github } = setup({
            removeLabel: jest.fn().mockRejectedValue(statusError),
        });

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            'Label was removed during the execution of the action, skipping.',
        );
    });

    test('fails with a clear message when required payload fields are missing', async () => {
        const { core, github } = setup({
            context: buildContext({ payload: null }),
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Missing pull request repository metadata in workflow payload.',
        );
    });

    test('fails with a helpful message when token permissions are missing', async () => {
        const permissionError = new Error(
            'Resource not accessible by integration - https://docs.github.com/rest/issues/labels#remove-a-label-from-an-issue',
        );
        permissionError.status = 403;

        const { core, github } = setup({
            removeLabel: jest.fn().mockRejectedValue(permissionError),
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Failed to remove label because the workflow token lacks required permissions. Ensure your workflow grants `contents: read` and `pull-requests: write`.',
        );
    });

    test('fails when pull request labels are missing in payload', async () => {
        const { core, github } = setup({
            context: buildContext({
                payload: {
                    pull_request: {
                        head: {
                            repo: {
                                full_name: 'fork-owner/repo',
                            },
                        },
                        number: 1,
                    },
                    repository: {
                        full_name: 'base-owner/repo',
                    },
                },
            }),
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Missing pull request labels in workflow payload.',
        );
    });

    test('rethrows errors when core.setFailed is unavailable', async () => {
        const rethrowingRun = require('./index');
        const expectedError = new Error('fatal setup error');

        await expect(rethrowingRun({
            core: null,
            github: {
                get context() {
                    throw expectedError;
                },
            },
        })).rejects.toThrow('fatal setup error');
    });

    test('converts non-Error failures to strings', async () => {
        const { core, github } = setup({
            removeLabel: jest.fn().mockRejectedValue('boom'),
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith('boom');
    });

    test('loads action dependencies dynamically', async () => {
        jest.resetModules();
        jest.doMock('@actions/core', () => ({
            getInput: jest.fn(),
        }), { virtual: true });
        jest.doMock('@actions/github', () => ({
            getOctokit: jest.fn(),
        }), { virtual: true });

        const { loadDependencies } = require('./index');
        const loaded = await loadDependencies();

        expect(loaded).toHaveProperty('core');
        expect(loaded).toHaveProperty('github');
        expect(typeof loaded.core.getInput).toBe('function');
        expect(typeof loaded.github.getOctokit).toBe('function');
    });

    test('runs successfully without dependency overrides', async () => {
        jest.resetModules();
        const coreMock = {
            getInput: jest.fn((name) => {
                if (name === 'label') {
                    return 'safe-to-test';
                }

                if (name === 'repo-token') {
                    return 'fake-token';
                }

                return '';
            }),
            setFailed: jest.fn(),
        };
        const removeLabelMock = jest.fn().mockResolvedValue(undefined);
        const githubMock = {
            context: buildContext(),
            getOctokit: jest.fn(() => ({
                rest: {
                    issues: {
                        removeLabel: removeLabelMock,
                    },
                },
            })),
        };

        jest.doMock('@actions/core', () => coreMock, { virtual: true });
        jest.doMock('@actions/github', () => githubMock, { virtual: true });

        const runWithoutOverrides = require('./index');
        await runWithoutOverrides();

        expect(githubMock.getOctokit).toHaveBeenCalledWith('fake-token');
        expect(removeLabelMock).toHaveBeenCalledTimes(1);
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });
});

function buildForkPayload({ labels = [{ name: 'safe-to-test' }] } = {}) {
    return {
        pull_request: {
            head: {
                repo: {
                    full_name: 'fork-owner/repo',
                },
            },
            labels,
            number: 1,
        },
        repository: {
            full_name: 'base-owner/repo',
        },
    };
}

function buildContext({
    eventName = 'pull_request',
    payload = buildForkPayload(),
    repo = { owner: 'base-owner', repo: 'repo' },
} = {}) {
    return {
        eventName,
        payload,
        repo,
    };
}

function setup({
    context = buildContext(),
    label = 'safe-to-test',
    token = 'fake-token',
    removeLabel,
} = {}) {
    const core = {
        getInput: jest.fn((name) => {
            if (name === 'label') {
                return label;
            }

            if (name === 'repo-token') {
                return token;
            }

            return '';
        }),
        setFailed: jest.fn(),
    };

    const removeLabelMock = removeLabel || jest.fn().mockResolvedValue(undefined);
    const github = {
        context,
        getOctokit: jest.fn(() => ({
            rest: {
                issues: {
                    removeLabel: removeLabelMock,
                },
            },
        })),
    };

    return { core, github, removeLabelMock };
}
