#!/usr/bin/env node
/**
 * Исполняемая дверь.
 *
 * Файл намеренно пустой по смыслу: он переводит процесс в вызов и обратно, и
 * ничего не решает. Всё, что можно проверить тестом, живёт в `cli()` — иначе
 * приёмка упиралась бы в запуск процесса, а поведение двери проверялось бы
 * глазами.
 */

import { cli } from '../lib/cli.js';

const outcome = await cli(process.argv.slice(2), process.cwd());

process.stdout.write(outcome.stdout);
process.exitCode = outcome.exitCode;
