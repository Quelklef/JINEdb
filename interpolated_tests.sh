#1/bin/bash

# Run test cases that are in markdown.
# 
# Will recursively search files for blocks that look like:
# 
#   ```ts
#   import [CODE] 'jinedb';
#   [CODE]
#   ```
# 
# and run the contained code as a test, expecting no errors.

newline='
'

trap "rm -rf src/__interp_test*" EXIT

rm -rf dist/

files="$(git ls-files)"
while read -r file; do

  echo "Checking $file ..."

  lines="$(cat "$file")"

  # location
  # text - just some text
  # head - first line of js code
  # body - body of js code
  loc=text

  # interpolated ts code
  ts_code=

  while read -r line; do

    case "$loc" in
      text)
        [[ "$line" == \`\`\`ts* ]] && loc=head
        ;;
      
      head)
        if [[ "$line" == import*jinedb* ]]; then
          # vvv Include indexeddb
          ts_code="$ts_code${newline}require('fake-indexeddb/auto');"
          # vvv Replace `import ... 'jinedb'` with `import ... './jine'`
          ts_code="$ts_code$newline${line/jinedb/./jine}"
          loc=body
        else
          loc=text
        fi
        ;;

      body)
        if [[ "$line" == \`\`\`* ]]; then
          loc=text
          if [ -n "$ts_code" ]; then
            # vvv Flatten but namespace tests by replacing `/` in path with `:`
            outloc="src/__interp_test::${file//\//:}.ts"
            echo "$ts_code" > "$outloc"
          fi
          ts_code=
        else
          ts_code="$ts_code$newline$line"
        fi
        ;;

    esac

  done <<< "$lines"

done <<< "$files"

# compile tests
echo "Compiling ..."
tsc || exit 1

# run tests
testlocs="$(find dist/ | grep '^dist/__interp_test.*\.js$')"
while read -r testloc; do
  echo "Running $testloc ..."
  node --trace-warnings --unhandled-rejections=strict "$testloc" && result=ok || result=err
  [[ "$result" == err ]] && echo "^^ Test failed ^^" && exit 1
done <<< "$testlocs"

exit 0
