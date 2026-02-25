const run = require('./index');

describe('remove-safe-to-test-label', () => {
    let core;
    let github;

    beforeEach(() => {
        core = {
            getInput: jest.fn(),
            setFailed: jest.fn(),
        };

        github = {
            context: {},
            getOctokit: jest.fn(),
        };
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    test('should remove the "safe-to-test" label when pull request is from a fork and has the label', async () => {
        const payload = {
            pull_request: {
                head: {
                    repo: {
                        full_name: 'fork-owner/repo',
                    },
                },
                base: {
                    repo: {
                        full_name: 'base-owner/repo',
                    },
                },
                labels: [
                    {
                        name: 'safe-to-test',
                    },
                ],
                number: 1,
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;
        github.context.repo = { owner: 'base-owner', repo: 'repo' };

        core.getInput.mockReturnValueOnce('safe-to-test');
        core.getInput.mockReturnValueOnce('fake-token');

        github.getOctokit.mockReturnValue({
            rest: {
                issues: {
                    removeLabel: jest.fn(),
                },
            },
        });

        await run({ core, github });

        expect(github.getOctokit).toHaveBeenCalledWith('fake-token');
        expect(github.getOctokit().rest.issues.removeLabel).toHaveBeenCalledWith({
            owner: 'base-owner',
            repo: 'repo',
            issue_number: 1,
            name: 'safe-to-test',
        });
    });

    test('should not remove the "safe-to-test" label when pull request is not from a fork', async () => {
        const payload = {
            pull_request: {
                head: {
                    repo: {
                        full_name: 'base-owner/repo',
                    },
                },
                base: {
                    repo: {
                        full_name: 'base-owner/repo',
                    },
                },
                labels: [
                    {
                        name: 'safe-to-test',
                    },
                ],
                number: 1,
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;
        github.context.repo = { owner: 'base-owner', repo: 'repo' };

        core.getInput.mockReturnValueOnce('safe-to-test');
        core.getInput.mockReturnValueOnce('fake-token');

        github.getOctokit.mockReturnValue({
            rest: {
                issues: {
                    removeLabel: jest.fn(),
                },
            },
        });

        await run({ core, github });

        expect(github.getOctokit).toHaveBeenCalledTimes(0);
        expect(github.getOctokit().rest.issues.removeLabel).toHaveBeenCalledTimes(0);
    });

    test('should skip when eventName is not allowed', async () => {
        const payload = {
            pull_request: {
                head: {
                    repo: {
                        full_name: 'fork-owner/repo',
                    },
                },
                base: {
                    repo: {
                        full_name: 'base-owner/repo',
                    },
                },
                labels: [],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'not_allowed_event';
        github.context.payload = payload;

        core.getInput.mockReturnValue('safe-to-test');
        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(github.getOctokit).toHaveBeenCalledTimes(0);
    });

    test('should fail when there is an error', async () => {
        github.context.eventName = 'pull_request';
        github.context.payload = null;

        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });
        expect(core.setFailed).toHaveBeenCalledTimes(1);
    });

    test('should handle the error when the label does not exist', async () => {
        // Mock console.log
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const payload = {
            pull_request: {
                head: {
                    repo: {
                        full_name: 'fork-owner/repo',
                    },
                },
                base: {
                    repo: {
                        full_name: 'base-owner/repo',
                    },
                },
                labels: [
                    {
                        name: 'safe-to-test',
                    },
                ],
                number: 1,
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;
        github.context.repo = { owner: 'base-owner', repo: 'repo' };

        core.getInput.mockReturnValueOnce('safe-to-test');

        const mockRemoveLabel = jest.fn().mockRejectedValue(new Error('Label does not exist'));
        github.getOctokit.mockReturnValue({
            rest: {
                issues: {
                    removeLabel: mockRemoveLabel,
                },
            },
        });

        await run({ core, github });

        expect(mockRemoveLabel).toHaveBeenCalledWith({
            owner: 'base-owner',
            repo: 'repo',
            issue_number: 1,
            name: 'safe-to-test',
        });
        expect(consoleSpy).toHaveBeenCalledWith('Label was removed during the execution of the action, skipping.');
        expect(core.setFailed).toHaveBeenCalledTimes(0); // Ensure setFailed was not called, indicating the action handled the error gracefully.

        // Restore console.log to its original implementation
        consoleSpy.mockRestore();
    });

    test('should use the configured label name in the missing-label log message', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const payload = {
            pull_request: {
                head: {
                    repo: {
                        full_name: 'fork-owner/repo',
                    },
                },
                base: {
                    repo: {
                        full_name: 'base-owner/repo',
                    },
                },
                labels: [
                    {
                        name: 'safe-to-test',
                    },
                ],
                number: 1,
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;

        core.getInput.mockReturnValue('qa-approved');

        await run({ core, github });

        expect(consoleSpy).toHaveBeenCalledWith('Pull request does not have the "qa-approved" label, skipping.');

        consoleSpy.mockRestore();
    });
});
