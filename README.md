# Ohmest

Timed, proctored exams for any school. Professors create an account (or join their school with a faculty code), build exams, and review results. Students need no account: they sign in with their school's **student code**, their name and their student ID.

## How schools work

- A professor who picks **New school** creates the school and gets two codes (shown on the dashboard):
  - **Student code**: give it to your classes. It is how a student is attached to your school.
  - **Faculty code**: give it to colleagues so they can create accounts under the same school.
- Every exam belongs to one professor and is only visible to students who sign in with that school's code. Schools cannot see each other's data.

## Features

Per-question server-side timers, shuffled questions and choices, numeric answers with per-student random values, follow-up questions, handwritten-work photo checks, tab/fullscreen/copy-paste tracking with integrity flags, class-list restriction, scheduling, announcements, Excel export and optional live push to Google Sheets (`google-apps-script/Code.gs`).

