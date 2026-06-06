
const DEFAULT_CSS = `
.flexrow {
    display:flex;
    gap:10px;
    min-width:0;
}

.flexcol {
    display:flex;
    flex-direction: column;
    gap: 10px;
    min-width:0;
}

p, h4 {
  overflow-wrap: anywhere;
}

.listable {
    border-top: solid thin lightgrey;
    padding:1rem;
    margin: 0 -1rem;
}

.clickable {
    border-top: thin solid lightgrey;
    padding: 15px;
    cursor:pointer;
}

.clickable:hover {
    background: whitesmoke;
    border-radius: 8px;
}

.smerpui{

}

.smerpui__header{
    with:100%;
    padding: 1rem;
    border-bottom: solid thin lightgrey;
}

.smerpui__content{
    padding: 1rem;
}

.smerpui__content .submitbtn {
    margin: 20px 0;
    border-radius: 6px;
    padding: 8px 12px;
    background: none;
    box-shadow: none;
    border: thin solid lightgrey; 
    cursor: pointer;
    width:fit-content;
}

.smerpui__content select{
    width: fit-content;
    border-radius: 4px;
    padding: 8px 12px;
    background: none;
    box-shadow: none;
    border: thin solid lightgrey; 
    color:grey;
}

.smerpui__content pre{
    white-space: pre-wrap;
    font-family: inherit;
    margin: 5px 0;
}
.smerpui__content label{
    color: grey;
    font-size: 13px;
    font-weight: 600;
    text-transform: capitalize;
}

.smerpui__content input, 
.smerpui__content textarea {
    border-radius: 8px;
    padding: 8px 12px;
    border: thin solid lightgrey;
    font-size: inherit;
}

.shade{
    border-radius: 4px;
    padding: 6px 10px;
    background: #eef1f4;
    width: fit-content;
    font-size: 14px;
    font-weight:600;
    margin-bottom: 10px;
}
`;

let stylesInstalled = false;

export function installStyles() {
  if (stylesInstalled) return;

  stylesInstalled = true;

  const style = document.createElement("style");
  style.textContent = DEFAULT_CSS;

  document.head.appendChild(style);
}
