# GitHub Project Setup

This repository includes a GitHub Actions workflow that automatically adds new issues to a GitHub Project for tracking feature requests and bugs.

## Setup Steps

### 1. Create a GitHub Project

1. Go to your GitHub profile → **Projects** → **New project**
2. Choose the **Board** template (recommended for feature tracking)
3. Name it e.g. **MedAssist-ng Roadmap**
4. Configure the default columns:
   - **Triage** – New issues land here
   - **Backlog** – Accepted but not yet started
   - **In Progress** – Currently being worked on
   - **Done** – Completed

### 2. Create a Personal Access Token (PAT)

The workflow needs a token with project permissions. The built-in `GITHUB_TOKEN` does not support GitHub Projects.

1. Go to **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. Click **Generate new token**
3. Set:
   - **Token name**: `add-to-project`
   - **Expiration**: Choose an appropriate duration
   - **Repository access**: Select **Only select repositories** → `DanielVolz/medassist-ng`
   - **Permissions**:
     - Repository permissions: **Issues** → Read
     - Organization permissions (if applicable): **Projects** → Read and write
   - For **user-owned projects**, you need a **classic** token with the `project` scope instead
4. Copy the generated token

### 3. Add Repository Secrets and Variables

1. Go to the repository → **Settings** → **Secrets and variables** → **Actions**
2. Add a **secret**:
   - Name: `ADD_TO_PROJECT_PAT`
   - Value: The PAT from step 2
3. Add a **variable** (under the **Variables** tab):
   - Name: `PROJECT_URL`
   - Value: The full URL of your GitHub Project (e.g. `https://github.com/users/DanielVolz/projects/1`)

### 4. Verify

1. Create a test issue using the **✨ Feature Request** template
2. Check the **Actions** tab to see the workflow run
3. Verify the issue appears in your GitHub Project under **Triage**

## How It Works

The workflow (`.github/workflows/add-to-project.yml`) triggers when:
- A new issue is **opened**
- A label is **added** to an existing issue

Issues with any of these labels are automatically added to the project:
- `enhancement` – Feature requests
- `bug` – Bug reports
- `triage` – New issues needing review

Both the feature request and bug report issue templates automatically apply the `triage` label, so all new issues from templates are captured.

## Customization

### Adding more labels

Edit `.github/workflows/add-to-project.yml` and add labels to the `labeled` field:

```yaml
labeled: enhancement, bug, triage, documentation
```

### Restricting to feature requests only

Change the `labeled` field to only include `enhancement`:

```yaml
labeled: enhancement
label-operator: OR
```
