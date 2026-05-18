# Contributing

Thanks for taking a look. Contributions are welcome, especially focused fixes and improvements. Larger changes will depend on a combination of my enthusiasm and contributors' enthusiasm.

First and foremost, this project is about making a pleasing, passive simulation of Mahjong.

## Small changes

* Mahjong logic bug fixes
* Bot improvements (mind performance as long as we are generating full games up-front)
* 3D aesthetics and performance
* Animations
* Sound effects

## Larger changes

* Support other Mahjong variants
* Support actually playing the game (3D interactions, scoring)
* Use existing strong bots, perhaps when turns are live/async instead of up-front

## Debugging

* Run `DEBUG=1 make dev` to enable debug-only routes and 3D controls
* Use `?view=debug` for the replay/event viewer
* Use `?view=debug-table-flip` for table flip tuning
* Use `?seed=...` to reproduce a round
* `test-*` seeds are scripted fixtures for specific rules and UI cases, not normal random seeds

## PRs

* Keep changes focused
* Use Bun for package management and scripts
* Keep simulation rules out of React UI code
* Test changes to macOS builds e2e carefully
* Preserve tile art attribution and license notes
* Run `make good`
