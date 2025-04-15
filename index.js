#!/usr/bin/env bun
// Bun script to replace hardcoded CSS values with existing custom properties.

import * as csstree from 'css-tree';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- Configuration ---
// Add node types whose values should be considered for replacement
const REPLACEABLE_NODE_TYPES = new Set([
	'Dimension',    // e.g., 16px, 2em
	'HexColor',     // e.g., #ff0000, #fff
	'Identifier',   // e.g., red, bold, sans-serif (can be tricky, use carefully)
	'Number',       // e.g., 1.5 (line-height), 700 (font-weight)
	'Percentage',   // e.g., 50%
	'Url',          // e.g., url(...)
	'String'        // e.g., 'Arial', "path/to/font.woff"
]);

// --- Helper Functions ---

/**
 * Generates the string representation of a css-tree node's value part.
 * Handles simple values and function arguments correctly.
 * @param {object} valueNode The css-tree Value node.
 * @returns {string} The string representation.
 */
function nodeValueToString(node) {
	// Use css-tree's generate function for accurate representation
	return csstree.generate(node).trim();
}

/**
 * Creates a css-tree node representing var(--custom-property).
 * @param {string} varName The custom property name (e.g., --my-color).
 * @returns {object} A css-tree Function node.
 */
function createVarFunctionNode(varName) {
	return {
		type: 'Function',
		name: 'var',
		children: new csstree.List().appendData({
			type: 'Identifier',
			name: varName
		})
	};
}


// --- Main Logic ---

async function processCssFile(inputFile, outputFile) {
	console.log(`Reading CSS file: ${inputFile}`);
	const inputFilePath = resolve(inputFile); // Ensure absolute path
	const outputFilePath = resolve(outputFile); // Ensure absolute path

	let cssContent;
	try {
		const file = Bun.file(inputFilePath);
		if (!(await file.exists())) {
			console.error(`Error: Input file not found at ${inputFilePath}`);
			process.exit(1);
		}
		cssContent = await file.text();
	} catch (err) {
		console.error(`Error reading file ${inputFile}:`, err.message);
		process.exit(1);
	}

	console.log("Parsing CSS...");
	let ast;
	try {
		ast = csstree.parse(cssContent, {
			parseValue: true, // Ensure values are parsed deeply
			parseCustomProperty: true // Ensure custom properties syntax is handled
		});
	} catch (parseError) {
		console.error("Error parsing CSS:", parseError.message);
		// Optionally show more details: console.error(parseError);
		process.exit(1);
	}

	console.log("Finding defined custom properties...");
	const customPropertiesMap = new Map(); // value -> customPropertyName

	csstree.walk(ast, (node) => {
		// Find declarations like --my-color: #fff;
		if (node.type === 'Declaration' && node.property.startsWith('--')) {
			const propName = node.property;
			// The value node might contain whitespace, generate it to string and trim
			const propValue = nodeValueToString(node.value);

			if (propName && propValue) {
				// If multiple props have the same value, the last one encountered wins.
				// You could modify this logic to store an array or prioritize.
				customPropertiesMap.set(propValue, propName);
			}
		}
	});

	console.log(`Found ${customPropertiesMap.size} unique custom property values.`);
	if (customPropertiesMap.size === 0) {
		console.log("No custom properties found. Writing original content.");
		try {
			await Bun.write(outputFilePath, cssContent);
			console.log(`Successfully wrote original content to ${outputFilePath}`);
		} catch (err) {
			console.error(`Error writing file ${outputFilePath}:`, err.message);
			process.exit(1);
		}
		return; // Exit early
	}

	// --- DEBUG: Print found map ---
	// console.log("Custom Properties Map:", customPropertiesMap);
	// ---

	console.log("Replacing hardcoded values...");
	let replacementsMade = 0;

	csstree.walk(ast, {
		visit: 'Declaration', // Only visit declaration nodes
		enter: (declarationNode) => {
			// Skip custom property definitions themselves
			if (declarationNode.property.startsWith('--')) {
				return;
			}

			// Walk through the children of the declaration's value
			// We need to modify the list in place, so iterate carefully
			declarationNode.value.children.forEach((valueNode, item, list) => {
				// Check if the node type is one we want to potentially replace
				if (REPLACEABLE_NODE_TYPES.has(valueNode.type)) {
					const nodeStrValue = nodeValueToString(valueNode);

					// Check if this exact value string exists in our map
					if (customPropertiesMap.has(nodeStrValue)) {
						const customPropName = customPropertiesMap.get(nodeStrValue);
						console.log(`  Replacing "${nodeStrValue}" with var(${customPropName}) in "${declarationNode.property}"`);

						// Replace the node in the list with the var() function node
						const varNode = createVarFunctionNode(customPropName);
						list.replace(item, list.createItem(varNode));

						replacementsMade++;
					}
				} else if (valueNode.type === 'Function') {
					// Optional: Handle values inside functions like linear-gradient(red, blue)
					// This requires recursive walking or more complex logic.
					// For simplicity, this example only replaces top-level value nodes.
					// You could potentially walk valueNode.children here if needed.
				}
			});
		}
	});


	console.log(`Made ${replacementsMade} replacements.`);
	console.log("Generating modified CSS...");
	const modifiedCss = csstree.generate(ast);

	console.log(`Writing modified CSS to ${outputFile}`);
	try {
		await Bun.write(outputFilePath, modifiedCss);
		console.log(`Successfully wrote modified CSS to ${outputFilePath}`);
	} catch (err) {
		console.error(`Error writing file ${outputFilePath}:`, err.message);
		process.exit(1);
	}
}

// --- Script Execution ---

// Basic command line argument check
const args = argv.slice(2); // Skip 'bun' and script name
if (args.length !== 2) {
	// Get the script name relative to the current directory if possible
	let scriptName = 'replace-css.js'; // Default
	try {
		// This works if the script is run directly
		const scriptPath = fileURLToPath(import.meta.url);
		scriptName = relative(process.cwd(), scriptPath);
	} catch (e) { /* ignore errors trying to get relative path */ }


	console.error(`Usage: bun run ${scriptName} <input-css-file> <output-css-file>`);
	console.error("Example: bun run ./replace-css.js styles/main.css styles/main.vars.css");
	process.exit(1);
}

const [inputFile, outputFile] = args;

// Run the main processing function
processCssFile(inputFile, outputFile).catch(err => {
	console.error("An unexpected error occurred:", err);
	process.exit(1);
});