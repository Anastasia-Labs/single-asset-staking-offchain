# single-asset-staking-offchain

## How to create github packages

https://docs.github.com/en/packages/quickstart

## Use tsup to bundle typescript

https://tsup.egoist.dev/

## How to release

https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository##creating-a-release

## Installation

#### Create `.npmrc` file, replace TOKEN with your personal access token.

```
@anastasia-labs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TOKEN
```

#### Install package

```
npm install @anastasia-labs/single-asset-staking-offchain
```

or

```
pnpm install @anastasia-labs/single-asset-staking-offchain
```

#### References

- Add GitHub Packages

  - https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry##installing-a-package

- Authenticate with personal access token
  - https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry##authenticating-with-a-personal-access-token

## Semantic versioning

https://semver.org/

## Workflow to create a new Github package release

Here's a step-by-step guide to create a new Github package release:

- Update the code.
- Commit the changes.
- Push the changes to the develop branch Github repository.
- Check if the Continuous Integration (CI) passes. If it does, proceed to the next step. If not, address the issues before proceeding further.
- Bump the library version based on the extent of the changes made. Here are the three options to do so:
  - For a small bug fix, run:
  ```
  pnpm version patch
  ```
  - For adding new functionality in a backward-compatible way, run:
  ```
  pnpm version minor
  ```
  - For making breaking changes to the code, run:
  ```
  pnpm version major
  ```
- After bumping the version, go to the Github project's releases page
- Create a new tag with the bumped version number.
- To create a new npm package in the github organization, make sure the Node.js package CI succeeds.
- If the CI Action fails, remove the release, tag, and commit the new changes. Then, push the changes and draft a new release.

## Test framework

https://github.com/vitest-dev/vitest

## Local Build

In the main directory

```
pnpm run build
```

## Installing sdk pacakage in local test folder

```
cd test
pnpm run test
```
